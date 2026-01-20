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
import yaml
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
    
    def __init__(self, memory_id: str, region: str = 'us-east-1'):
        """
        Initialize the sync module.
        
        Args:
            memory_id: AgentCore Memory ID
            region: AWS region
        """
        self.memory_id = memory_id
        self.region = region
        self.repo_name = os.getenv('KNOWLEDGE_REPO_NAME', 'second-brain-knowledge')
        
        # Initialize clients lazily
        self._memory_client = None
        self._codecommit_client = None
    
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
    
    def parse_front_matter(self, content: str) -> Optional[dict]:
        """
        Parse YAML front matter from markdown content.
        
        Args:
            content: Markdown file content
            
        Returns:
            Parsed front matter dict or None if invalid
            
        Validates: Requirements 1.4, 1.5
        """
        if not content.startswith('---\n'):
            return None
        
        # Find closing delimiter
        end_match = re.search(r'\n---\n', content[4:])
        if not end_match:
            return None
        
        yaml_block = content[4:4 + end_match.start()]
        
        try:
            return yaml.safe_load(yaml_block)
        except yaml.YAMLError:
            return None
    
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

    
    def get_sync_marker(self, actor_id: str) -> Optional[str]:
        """
        Get the last synced commit ID from Memory.
        
        Args:
            actor_id: User/actor ID for scoped storage
            
        Returns:
            Last synced commit ID or None if not found
            
        Validates: Requirements 1.1
        """
        if not self.memory_client:
            return None
        
        try:
            # Search for sync marker in Memory
            response = self.memory_client.retrieve_memories(
                memory_id=self.memory_id,
                actor_id=actor_id,
                namespace=f'/sync/{actor_id}',
                query='last synced commit',
                top_k=1,
            )
            
            # Parse commit ID from response
            if response and 'memories' in response and response['memories']:
                memory = response['memories'][0]
                content = memory.get('content', '')
                # Extract commit ID from "Last synced commit: <commit_id>"
                match = re.search(r'Last synced commit: ([a-f0-9]+)', content)
                if match:
                    return match.group(1)
            
            return None
        except Exception as e:
            print(f"Warning: Failed to get sync marker: {e}")
            return None
    
    def update_sync_marker(self, actor_id: str, commit_id: str) -> bool:
        """
        Update the sync marker in Memory.
        
        Args:
            actor_id: User/actor ID for scoped storage
            commit_id: New commit ID to store
            
        Returns:
            True if successful, False otherwise
            
        Validates: Requirements 1.7
        """
        if not self.memory_client:
            return False
        
        try:
            # Store sync marker as an event
            self.memory_client.create_event(
                memory_id=self.memory_id,
                actor_id=actor_id,
                session_id=f'sync-marker-{actor_id}',
                messages=[
                    (f'Last synced commit: {commit_id}', 'ASSISTANT'),
                ],
            )
            return True
        except Exception as e:
            print(f"Warning: Failed to update sync marker: {e}")
            return False

    
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
        Store item metadata in Memory using create_event.
        
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
            # Format item as text for semantic storage
            item_text = item.to_memory_text()
            
            # Store as conversation event in /items namespace
            self.memory_client.create_event(
                memory_id=self.memory_id,
                actor_id=actor_id,
                session_id=f'item-{item.sb_id}',
                messages=[
                    (item_text, 'ASSISTANT'),
                ],
            )
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

    
    def sync_items(self, actor_id: str) -> SyncResult:
        """
        Sync items from CodeCommit to Memory for the given actor.
        
        This is the main entry point for the sync operation.
        
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
            
            # Get last synced commit
            last_sync = self.get_sync_marker(actor_id)
            
            # Check if sync is needed (incremental optimization)
            if last_sync == head_commit:
                # Already synced, skip
                return SyncResult(
                    success=True,
                    items_synced=0,
                    items_deleted=0,
                    new_commit_id=head_commit,
                )
            
            # Get changed files
            changed_files = self.get_changed_files(last_sync, head_commit)
            
            items_synced = 0
            items_deleted = 0
            
            for file_info in changed_files:
                path = file_info['path']
                change_type = file_info['change_type']
                
                if change_type == 'D':
                    # File deleted - extract sb_id from path and delete from Memory
                    # Path format: 10-ideas/2025-01-20__title__sb-xxxxxxx.md
                    match = re.search(r'sb-[a-f0-9]{7}', path)
                    if match:
                        self.delete_item_from_memory(actor_id, match.group(0))
                        items_deleted += 1
                else:
                    # File added or modified - fetch content and store
                    content = self.get_file_content(path, head_commit)
                    if content:
                        metadata = self.extract_item_metadata(path, content)
                        if metadata:
                            if self.store_item_in_memory(actor_id, metadata):
                                items_synced += 1
            
            # Update sync marker
            self.update_sync_marker(actor_id, head_commit)
            
            return SyncResult(
                success=True,
                items_synced=items_synced,
                items_deleted=items_deleted,
                new_commit_id=head_commit,
            )
            
        except Exception as e:
            return SyncResult(
                success=False,
                error=str(e),
            )
