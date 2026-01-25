"""
Item Sync Module for Memory-Based Item Lookup

Syncs CodeCommit knowledge items to AgentCore Memory for reliable cross-item linking.
Replaces the unreliable use_aws tool-based approach.

Features:
- Incremental sync using commit ID marker
- Front matter parsing for metadata extraction
- Graceful degradation on failures

Validates: Requirements 1.1-1.8, 5.1-5.5, 6.1-6.4
"""

import os
import re
import boto3
from dataclasses import dataclass, field
from typing import List, Optional

# AgentCore Memory client
try:
    from bedrock_agentcore.memory import MemoryClient
    MEMORY_AVAILABLE = True
except ImportError:
    MEMORY_AVAILABLE = False


@dataclass
class ItemMetadata:
    """
    Metadata extracted from a knowledge item file.
    
    Validates: Requirements 6.1, 6.2, 6.3
    """
    sb_id: str           # e.g., "sb-a7f3c2d"
    title: str           # e.g., "Home Landscaping Project"
    item_type: str       # "idea", "decision", or "project"
    path: str            # e.g., "30-projects/2025-01-18__home-landscaping__sb-a7f3c2d.md"
    tags: List[str] = field(default_factory=list)  # e.g., ["landscaping", "home"]
    status: Optional[str] = None  # For projects: "active", "on-hold", "complete", "cancelled"
    
    def to_memory_text(self) -> str:
        """
        Format metadata as text for Memory storage.
        
        The format is human-readable and suitable for semantic search.
        
        Validates: Requirements 6.1, 6.2, 6.3
        """
        lines = [
            f"Item: {self.title}",
            f"ID: {self.sb_id}",
            f"Type: {self.item_type}",
            f"Path: {self.path}",
        ]
        if self.tags:
            lines.append(f"Tags: {', '.join(self.tags)}")
        if self.status:
            lines.append(f"Status: {self.status}")
        return "\n".join(lines)


@dataclass
class SyncResult:
    """
    Result of a sync operation.
    
    Validates: Requirements 1.7, 7.1, 7.2
    """
    success: bool
    items_synced: int = 0
    items_deleted: int = 0
    new_commit_id: Optional[str] = None
    error: Optional[str] = None


@dataclass
class HealthReport:
    """
    Health check report comparing CodeCommit and Memory item counts.
    
    Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
    """
    codecommit_count: int
    memory_count: int
    in_sync: bool
    last_sync_timestamp: Optional[str]
    last_sync_commit_id: Optional[str]
    missing_in_memory: List[str]  # sb_ids missing in Memory
    extra_in_memory: List[str]    # sb_ids in Memory but not in CodeCommit


class ItemSyncModule:
    """
    Syncs CodeCommit knowledge items to AgentCore Memory.
    
    Validates: Requirements 1.1-1.8, 5.1-5.5
    """
    
    # Folders containing knowledge items
    ITEM_FOLDERS = ['10-ideas/', '20-decisions/', '30-projects/']
    
    # Type mapping from folder prefix
    FOLDER_TO_TYPE = {
        '10-ideas': 'idea',
        '20-decisions': 'decision',
        '30-projects': 'project',
    }
    
    def __init__(self, memory_id: str, region: str = 'us-east-1', sync_marker_param: str = None):
        """
        Initialize the sync module.
        
        Args:
            memory_id: AgentCore Memory ID
            region: AWS region
            sync_marker_param: SSM parameter name for sync marker (optional)
        """
        self.memory_id = memory_id
        self.region = region
        self.repo_name = os.getenv('KNOWLEDGE_REPO_NAME', 'second-brain-knowledge')
        self.sync_marker_param = sync_marker_param or os.getenv('SYNC_MARKER_PARAM', '/second-brain/last-sync-commit')
        
        # Initialize clients lazily
        self._memory_client = None
        self._codecommit_client = None
        self._ssm_client = None
    
    @property
    def memory_client(self):
        """Lazy initialization of Memory client."""
        if self._memory_client is None and MEMORY_AVAILABLE:
            self._memory_client = MemoryClient(region_name=self.region)
        return self._memory_client
    
    @property
    def codecommit_client(self):
        """Lazy initialization of CodeCommit client."""
        if self._codecommit_client is None:
            self._codecommit_client = boto3.client('codecommit', region_name=self.region)
        return self._codecommit_client
    
    @property
    def ssm_client(self):
        """Lazy initialization of SSM client."""
        if self._ssm_client is None:
            self._ssm_client = boto3.client('ssm', region_name=self.region)
        return self._ssm_client
    
    def get_sync_marker(self) -> Optional[str]:
        """Get the last synced commit ID from SSM."""
        try:
            response = self.ssm_client.get_parameter(Name=self.sync_marker_param)
            value = response['Parameter']['Value']
            return None if value == 'initial' else value
        except Exception as e:
            print(f"Warning: Failed to get sync marker: {e}")
            return None
    
    def set_sync_marker(self, commit_id: str) -> bool:
        """Update the sync marker in SSM."""
        try:
            self.ssm_client.put_parameter(
                Name=self.sync_marker_param,
                Value=commit_id,
                Type='String',
                Overwrite=True
            )
            return True
        except Exception as e:
            print(f"Warning: Failed to set sync marker: {e}")
            return False
        return self._codecommit_client
    
    def parse_front_matter(self, content: str) -> Optional[dict]:
        """
        Parse YAML front matter from markdown content.
        
        Uses simple regex parsing to avoid PyYAML dependency in Lambda.
        Handles Obsidian-compatible format with blank lines around delimiters.
        
        Args:
            content: Markdown file content
            
        Returns:
            Parsed front matter dict or None if invalid
            
        Validates: Requirements 1.4, 1.5
        """
        if not content.startswith('---\n'):
            return None
        
        # Find closing delimiter (may have blank line before it)
        # Try \n\n---\n first (Obsidian format), then \n---\n (standard)
        end_match = re.search(r'\n\n---\n', content[4:])
        if end_match:
            yaml_block = content[4:4 + end_match.start()]
        else:
            end_match = re.search(r'\n---\n', content[4:])
            if not end_match:
                return None
            yaml_block = content[4:4 + end_match.start()]
        
        try:
            return self._parse_simple_yaml(yaml_block)
        except Exception:
            return None
    
    def _parse_simple_yaml(self, yaml_text: str) -> dict:
        """
        Simple YAML parser for front matter.
        
        Handles basic key-value pairs and simple arrays.
        Does not support nested objects or complex YAML features.
        
        Args:
            yaml_text: YAML text to parse
            
        Returns:
            Parsed dict
        """
        result = {}
        current_key = None
        current_list = None
        
        for line in yaml_text.split('\n'):
            # Skip empty lines
            if not line.strip():
                continue
            
            # Check for list item (starts with -)
            if line.startswith('  - '):
                if current_list is not None:
                    value = line[4:].strip()
                    # Remove quotes if present
                    if value.startswith('"') and value.endswith('"'):
                        value = value[1:-1]
                    elif value.startswith("'") and value.endswith("'"):
                        value = value[1:-1]
                    current_list.append(value)
                continue
            
            # Check for key-value pair
            match = re.match(r'^(\w+):\s*(.*)$', line)
            if match:
                key = match.group(1)
                value = match.group(2).strip()
                
                # If value is empty, this might be a list
                if not value:
                    current_key = key
                    current_list = []
                    result[key] = current_list
                else:
                    # Remove quotes if present
                    if value.startswith('"') and value.endswith('"'):
                        value = value[1:-1]
                    elif value.startswith("'") and value.endswith("'"):
                        value = value[1:-1]
                    result[key] = value
                    current_key = None
                    current_list = None
        
        return result
    
    def extract_item_metadata(self, file_path: str, content: str) -> Optional[ItemMetadata]:
        """
        Parse front matter and extract item metadata.
        
        Args:
            file_path: Path to the file in the repository
            content: File content
            
        Returns:
            ItemMetadata or None if parsing fails
            
        Validates: Requirements 1.4, 1.5
        """
        front_matter = self.parse_front_matter(content)
        if not front_matter:
            return None
        
        # Required fields
        sb_id = front_matter.get('id')
        title = front_matter.get('title')
        item_type = front_matter.get('type')
        
        if not all([sb_id, title, item_type]):
            return None
        
        # Validate sb_id format
        if not re.match(r'^sb-[a-f0-9]{7}$', sb_id):
            return None
        
        # Optional fields
        tags = front_matter.get('tags', [])
        if not isinstance(tags, list):
            tags = []
        
        status = front_matter.get('status') if item_type == 'project' else None
        
        return ItemMetadata(
            sb_id=sb_id,
            title=title,
            item_type=item_type,
            path=file_path,
            tags=tags,
            status=status,
        )

    
    def get_codecommit_head(self) -> Optional[str]:
        """
        Get the current HEAD commit ID from CodeCommit.
        
        Returns:
            HEAD commit ID or None if error
        """
        try:
            response = self.codecommit_client.get_branch(
                repositoryName=self.repo_name,
                branchName='main',
            )
            return response['branch']['commitId']
        except Exception as e:
            print(f"Warning: Failed to get CodeCommit HEAD: {e}")
            return None
    
    def get_changed_files(self, old_commit: Optional[str], new_commit: str) -> List[dict]:
        """
        Get list of changed files between commits using GetDifferences.
        
        Args:
            old_commit: Previous commit ID (None for initial sync)
            new_commit: Current commit ID
            
        Returns:
            List of dicts with 'path' and 'change_type' keys
            
        Validates: Requirements 1.3, 5.2, 5.3
        """
        try:
            if old_commit is None:
                # Initial sync - get all files in item folders
                return self._get_all_item_files(new_commit)
            
            # Get differences between commits
            response = self.codecommit_client.get_differences(
                repositoryName=self.repo_name,
                beforeCommitSpecifier=old_commit,
                afterCommitSpecifier=new_commit,
            )
            
            changed_files = []
            for diff in response.get('differences', []):
                # Get the file path (afterBlob for adds/modifies, beforeBlob for deletes)
                if diff.get('afterBlob'):
                    path = diff['afterBlob']['path']
                    change_type = 'A' if diff.get('changeType') == 'A' else 'M'
                elif diff.get('beforeBlob'):
                    path = diff['beforeBlob']['path']
                    change_type = 'D'
                else:
                    continue
                
                # Filter for item folders only
                if any(path.startswith(folder) for folder in self.ITEM_FOLDERS):
                    if path.endswith('.md'):
                        changed_files.append({
                            'path': path,
                            'change_type': change_type,
                        })
            
            return changed_files
        except Exception as e:
            print(f"Warning: Failed to get changed files: {e}")
            return []
    
    def _get_all_item_files(self, commit_id: str) -> List[dict]:
        """
        Get all item files for initial sync.
        
        Args:
            commit_id: Commit ID to read from
            
        Returns:
            List of dicts with 'path' and 'change_type' keys
        """
        all_files = []
        
        for folder in self.ITEM_FOLDERS:
            try:
                response = self.codecommit_client.get_folder(
                    repositoryName=self.repo_name,
                    commitSpecifier=commit_id,
                    folderPath=folder.rstrip('/'),
                )
                
                for file_info in response.get('files', []):
                    path = file_info['absolutePath']
                    if path.endswith('.md') and not path.endswith('.gitkeep'):
                        all_files.append({
                            'path': path,
                            'change_type': 'A',  # Treat as add for initial sync
                        })
            except self.codecommit_client.exceptions.FolderDoesNotExistException:
                # Folder doesn't exist yet, skip
                continue
            except Exception as e:
                print(f"Warning: Failed to list folder {folder}: {e}")
                continue
        
        return all_files
    
    def get_file_content(self, file_path: str, commit_id: str) -> Optional[str]:
        """
        Get file content from CodeCommit.
        
        Args:
            file_path: Path to file
            commit_id: Commit ID to read from
            
        Returns:
            File content as string or None if error
        """
        try:
            response = self.codecommit_client.get_file(
                repositoryName=self.repo_name,
                commitSpecifier=commit_id,
                filePath=file_path,
            )
            return response['fileContent'].decode('utf-8')
        except Exception as e:
            print(f"Warning: Failed to get file {file_path}: {e}")
            return None

    
    def store_item_in_memory(self, actor_id: str, item: ItemMetadata) -> bool:
        """
        Store item metadata in Memory using batch_create_memory_records API.
        
        Uses the batch API to store items directly without strategy processing.
        This preserves the structured metadata exactly as formatted, avoiding
        the SemanticExtractor's summarization behavior.
        
        Items are stored in the /items/{actor_id} namespace for direct retrieval.
        
        Args:
            actor_id: User/actor ID for scoped storage
            item: Item metadata to store
            
        Returns:
            True if successful, False otherwise
            
        Validates: Requirements 1.6, 5.4
        """
        if not self.memory_client:
            return False
        
        try:
            from datetime import datetime, timezone
            
            # Format item as text for storage
            item_text = item.to_memory_text()
            
            # Use the gmdp_client's batch_create_memory_records API
            # This bypasses strategy processing and stores directly
            response = self.memory_client.gmdp_client.batch_create_memory_records(
                memoryId=self.memory_id,
                records=[{
                    'requestIdentifier': item.sb_id,
                    'namespaces': [f'/items/{actor_id}'],
                    'content': {'text': item_text},
                    'timestamp': datetime.now(timezone.utc),  # Required by API
                }]
            )
            
            # Check for failures
            failed = response.get('failedRecords', [])
            if failed:
                print(f"Warning: Failed to store item {item.sb_id}: {failed[0].get('errorMessage', 'Unknown error')}")
                return False
            
            return True
        except Exception as e:
            print(f"Warning: Failed to store item {item.sb_id}: {e}")
            return False
    
    def delete_item_from_memory(self, actor_id: str, sb_id: str) -> bool:
        """
        Delete item from Memory.
        
        Note: AgentCore Memory may not support direct deletion.
        This is a placeholder for future implementation.
        
        Args:
            actor_id: User/actor ID
            sb_id: Item ID to delete
            
        Returns:
            True if successful, False otherwise
            
        Validates: Requirements 6.4
        """
        # AgentCore Memory doesn't have a direct delete API
        # Items will naturally expire based on EventExpiryDuration
        # For now, we log the deletion intent
        print(f"Info: Item {sb_id} marked for deletion (will expire naturally)")
        return True

    def sync_single_item(self, actor_id: str, file_path: str, content: str) -> SyncResult:
        """
        Sync a single item to Memory.
        
        Used for event-driven sync after commits. This method extracts metadata
        from the provided content and stores it in Memory without needing to
        fetch from CodeCommit.
        
        Args:
            actor_id: User/actor ID for scoped storage
            file_path: Path to the committed file (e.g., "10-ideas/2025-01-20__title__sb-1234567.md")
            content: File content with YAML front matter
            
        Returns:
            SyncResult with success status and items_synced count
            
        Validates: Requirements 1.2, 1.3
        """
        try:
            # Extract metadata from content
            metadata = self.extract_item_metadata(file_path, content)
            
            if not metadata:
                return SyncResult(
                    success=False,
                    items_synced=0,
                    error=f"Failed to extract metadata from {file_path}",
                )
            
            # Store in Memory
            if self.store_item_in_memory(actor_id, metadata):
                print(f"Info: Synced item {metadata.sb_id} to Memory")
                return SyncResult(
                    success=True,
                    items_synced=1,
                    items_deleted=0,
                )
            else:
                return SyncResult(
                    success=False,
                    items_synced=0,
                    error=f"Failed to store item {metadata.sb_id} in Memory",
                )
                
        except Exception as e:
            print(f"Warning: Failed to sync single item: {e}")
            return SyncResult(
                success=False,
                items_synced=0,
                error=str(e),
            )

    def get_all_codecommit_items(self) -> List[ItemMetadata]:
        """
        Retrieve all items from CodeCommit for health check comparison.
        
        Scans all item folders (ideas, decisions, projects) and extracts
        metadata from each markdown file.
        
        Returns:
            List of ItemMetadata for all items in CodeCommit
            
        Validates: Requirements 5.1
        """
        items = []
        
        try:
            # Get current HEAD commit
            head_commit = self.get_codecommit_head()
            if not head_commit:
                print("Warning: Failed to get CodeCommit HEAD for health check")
                return items
            
            # Get all item files
            all_files = self._get_all_item_files(head_commit)
            
            for file_info in all_files:
                path = file_info['path']
                content = self.get_file_content(path, head_commit)
                if content:
                    metadata = self.extract_item_metadata(path, content)
                    if metadata:
                        items.append(metadata)
            
            return items
            
        except Exception as e:
            print(f"Warning: Failed to get CodeCommit items: {e}")
            return items
    
    def get_all_memory_items(self, actor_id: str) -> List[ItemMetadata]:
        """
        Retrieve all items from Memory for an actor.
        
        Used for health check comparison. Lists all memory records in the
        /items/{actor_id} namespace.
        
        Items are stored in /items/{actor_id} namespace using batch_create_memory_records.
        
        Args:
            actor_id: User/actor ID for scoped storage
            
        Returns:
            List of ItemMetadata for all items in Memory
            
        Validates: Requirements 5.2
        """
        items = []
        
        if not self.memory_client:
            print("Warning: Memory client unavailable for health check")
            return items
        
        try:
            # Use list_memory_records API to get all items in the namespace
            # This is more reliable than retrieve_memories (semantic search)
            namespace = f'/items/{actor_id}'
            
            print(f"Debug: Calling list_memory_records with memoryId={self.memory_id}, namespace={namespace}")
            
            response = self.memory_client.gmdp_client.list_memory_records(
                memoryId=self.memory_id,
                namespace=namespace,
                maxResults=100,
            )
            
            print(f"Debug: list_memory_records response keys: {response.keys() if response else 'None'}")
            
            if not response:
                print("Debug: No response from list_memory_records")
                return items
            
            summaries = response.get('memoryRecordSummaries', [])
            print(f"Debug: Found {len(summaries)} memoryRecordSummaries")
            
            # Response contains memoryRecordSummaries
            for i, record in enumerate(summaries):
                content = record.get('content', {})
                
                # Content is returned as {'text': '...'} 
                if isinstance(content, dict):
                    content = content.get('text', '')
                
                if i == 0:
                    print(f"Debug: First record content (first 200 chars): {content[:200]}")
                
                # Parse item metadata from stored text format
                # Format: "Item: <title>\nID: <sb_id>\nType: <type>\nPath: <path>\n..."
                metadata = self._parse_memory_item(content)
                if metadata:
                    items.append(metadata)
                elif i < 3:
                    print(f"Debug: Failed to parse record {i}: {content[:100]}")
            
            print(f"Debug: Successfully parsed {len(items)} items from Memory")
            return items
            
        except Exception as e:
            print(f"Warning: Failed to get Memory items: {e}")
            import traceback
            traceback.print_exc()
            return items
    
    def _parse_memory_item(self, content: str) -> Optional[ItemMetadata]:
        """
        Parse ItemMetadata from Memory event text format.
        
        Args:
            content: Memory event content in the format produced by to_memory_text()
            
        Returns:
            ItemMetadata or None if parsing fails
        """
        try:
            # Skip sync markers and other non-item content
            if 'Last synced commit:' in content:
                return None
            
            # Parse the stored format
            lines = content.strip().split('\n')
            
            title = None
            sb_id = None
            item_type = None
            path = None
            tags = []
            status = None
            
            for line in lines:
                if line.startswith('Item: '):
                    title = line[6:].strip()
                elif line.startswith('ID: '):
                    sb_id = line[4:].strip()
                elif line.startswith('Type: '):
                    item_type = line[6:].strip()
                elif line.startswith('Path: '):
                    path = line[6:].strip()
                elif line.startswith('Tags: '):
                    tags_str = line[6:].strip()
                    tags = [t.strip() for t in tags_str.split(',') if t.strip()]
                elif line.startswith('Status: '):
                    status = line[8:].strip()
            
            # Validate required fields
            if not all([title, sb_id, item_type, path]):
                return None
            
            # Validate sb_id format
            if not re.match(r'^sb-[a-f0-9]{7}$', sb_id):
                return None
            
            return ItemMetadata(
                sb_id=sb_id,
                title=title,
                item_type=item_type,
                path=path,
                tags=tags,
                status=status,
            )
            
        except Exception as e:
            print(f"Warning: Failed to parse memory item: {e}")
            return None
    
    def get_health_report(self, actor_id: str) -> HealthReport:
        """
        Compare CodeCommit and Memory item counts.
        
        Counts items in both CodeCommit (ideas, decisions, projects folders)
        and Memory, then identifies any discrepancies between them.
        
        Args:
            actor_id: User/actor ID for scoped storage
            
        Returns:
            HealthReport with counts and discrepancies
            
        Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
        """
        try:
            # Get all items from CodeCommit
            codecommit_items = self.get_all_codecommit_items()
            codecommit_sb_ids = {item.sb_id for item in codecommit_items}
            
            # Get all items from Memory
            memory_items = self.get_all_memory_items(actor_id)
            memory_sb_ids = {item.sb_id for item in memory_items}
            
            # Calculate discrepancies
            missing_in_memory = list(codecommit_sb_ids - memory_sb_ids)
            extra_in_memory = list(memory_sb_ids - codecommit_sb_ids)
            
            # Limit to 10 items as per requirement 5.5
            missing_in_memory = missing_in_memory[:10]
            extra_in_memory = extra_in_memory[:10]
            
            # Determine if in sync
            in_sync = len(missing_in_memory) == 0 and len(extra_in_memory) == 0
            
            # Get current HEAD commit for reference
            head_commit = self.get_codecommit_head()
            
            return HealthReport(
                codecommit_count=len(codecommit_items),
                memory_count=len(memory_items),
                in_sync=in_sync,
                last_sync_timestamp=None,  # No longer tracking sync marker
                last_sync_commit_id=head_commit,
                missing_in_memory=missing_in_memory,
                extra_in_memory=extra_in_memory,
            )
            
        except Exception as e:
            print(f"Warning: Failed to generate health report: {e}")
            # Return a report indicating failure
            return HealthReport(
                codecommit_count=0,
                memory_count=0,
                in_sync=False,
                last_sync_timestamp=None,
                last_sync_commit_id=None,
                missing_in_memory=[],
                extra_in_memory=[],
            )

    def sync_items(self, actor_id: str) -> SyncResult:
        """
        Sync all items from CodeCommit to Memory for the given actor.
        
        Uses delta sync when possible - only syncs files changed since last sync.
        Falls back to full sync if no sync marker exists.
        
        Args:
            actor_id: User/actor ID for scoped storage
            
        Returns:
            SyncResult with status and counts
            
        Validates: Requirements 1.1, 1.2, 1.3, 5.1, 5.2
        """
        try:
            # Get current HEAD commit
            head_commit = self.get_codecommit_head()
            if not head_commit:
                return SyncResult(
                    success=False,
                    error="Failed to get CodeCommit HEAD commit",
                )
            
            # Get last synced commit from SSM
            last_sync_commit = self.get_sync_marker()
            
            # Determine if we can do delta sync
            if last_sync_commit and last_sync_commit != head_commit:
                # Delta sync - only process changed files
                changed_files = self.get_changed_files(last_sync_commit, head_commit)
                print(f"Delta sync: {len(changed_files)} files changed since {last_sync_commit[:7]}")
                
                items_synced = 0
                items_deleted = 0
                
                for file_info in changed_files:
                    path = file_info['path']
                    change_type = file_info.get('change_type', 'M')
                    
                    if change_type == 'D':
                        # File deleted - remove from Memory
                        sb_id_match = path.split('/')[-1].replace('.md', '')
                        if sb_id_match.startswith('sb-'):
                            if self.delete_item_from_memory(actor_id, sb_id_match):
                                items_deleted += 1
                    else:
                        # File added or modified - sync to Memory
                        content = self.get_file_content(path, head_commit)
                        if content:
                            metadata = self.extract_item_metadata(path, content)
                            if metadata:
                                if self.store_item_in_memory(actor_id, metadata):
                                    items_synced += 1
                
                # Update sync marker
                self.set_sync_marker(head_commit)
                
                return SyncResult(
                    success=True,
                    items_synced=items_synced,
                    items_deleted=items_deleted,
                    new_commit_id=head_commit,
                )
            
            elif last_sync_commit == head_commit:
                # Already in sync - nothing to do
                print(f"Already in sync at {head_commit[:7]}")
                return SyncResult(
                    success=True,
                    items_synced=0,
                    items_deleted=0,
                    new_commit_id=head_commit,
                )
            
            else:
                # No sync marker - do full sync
                print(f"Full sync (no marker): syncing all items to {head_commit[:7]}")
                all_files = self._get_all_item_files(head_commit)
                
                items_synced = 0
                
                for file_info in all_files:
                    path = file_info['path']
                    content = self.get_file_content(path, head_commit)
                    if content:
                        metadata = self.extract_item_metadata(path, content)
                        if metadata:
                            if self.store_item_in_memory(actor_id, metadata):
                                items_synced += 1
                
                # Set initial sync marker
                self.set_sync_marker(head_commit)
                
                return SyncResult(
                    success=True,
                    items_synced=items_synced,
                    items_deleted=0,
                    new_commit_id=head_commit,
                )
            
        except Exception as e:
            return SyncResult(
                success=False,
                error=str(e),
            )

# Force rebuild Sun Jan 25 14:30:00 EST 2026
