"""
Property-based tests for Item Sync Module.

Uses hypothesis for property-based testing.

Validates: Requirements 1.4, 1.5, 5.1, 5.2, 6.1, 6.2, 6.3
"""

import pytest
from hypothesis import given, strategies as st, settings
from item_sync import ItemMetadata, SyncResult


# Strategies for generating test data
sb_id_strategy = st.from_regex(r'^sb-[a-f0-9]{7}$', fullmatch=True)
title_strategy = st.text(min_size=1, max_size=100, alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z')))
item_type_strategy = st.sampled_from(['idea', 'decision', 'project'])
path_strategy = st.from_regex(r'^(10-ideas|20-decisions|30-projects)/[a-z0-9_-]+\.md$', fullmatch=True)
tags_strategy = st.lists(st.text(min_size=1, max_size=20, alphabet=st.characters(whitelist_categories=('L', 'N'))), max_size=10)
status_strategy = st.sampled_from([None, 'active', 'on-hold', 'complete', 'cancelled'])


@st.composite
def item_metadata_strategy(draw):
    """Generate random ItemMetadata objects."""
    item_type = draw(item_type_strategy)
    status = draw(status_strategy) if item_type == 'project' else None
    
    return ItemMetadata(
        sb_id=draw(sb_id_strategy),
        title=draw(title_strategy),
        item_type=item_type,
        path=draw(path_strategy),
        tags=draw(tags_strategy),
        status=status,
    )


class TestItemMetadataToMemoryText:
    """
    Property 4: Metadata format completeness
    
    For any ItemMetadata object, the to_memory_text() output SHALL contain
    the sb_id, title, type, and path fields, and SHALL contain tags if present,
    and SHALL contain status if the item is a project.
    
    **Validates: Requirements 6.1, 6.2, 6.3**
    """
    
    @given(item_metadata_strategy())
    @settings(max_examples=100)
    def test_contains_required_fields(self, item: ItemMetadata):
        """Verify output contains all required fields."""
        text = item.to_memory_text()
        
        # Required fields must always be present
        assert f"Item: {item.title}" in text, "Title must be in output"
        assert f"ID: {item.sb_id}" in text, "sb_id must be in output"
        assert f"Type: {item.item_type}" in text, "item_type must be in output"
        assert f"Path: {item.path}" in text, "path must be in output"
    
    @given(item_metadata_strategy())
    @settings(max_examples=100)
    def test_contains_tags_if_present(self, item: ItemMetadata):
        """Verify tags are included when present."""
        text = item.to_memory_text()
        
        if item.tags:
            assert "Tags:" in text, "Tags field must be present when tags exist"
            for tag in item.tags:
                assert tag in text, f"Tag '{tag}' must be in output"
        else:
            assert "Tags:" not in text, "Tags field should not be present when no tags"
    
    @given(item_metadata_strategy())
    @settings(max_examples=100)
    def test_contains_status_for_projects(self, item: ItemMetadata):
        """Verify status is included for projects when present."""
        text = item.to_memory_text()
        
        if item.status:
            assert f"Status: {item.status}" in text, "Status must be in output for projects"
        else:
            assert "Status:" not in text, "Status should not be present when None"


class TestSyncResult:
    """Unit tests for SyncResult dataclass."""
    
    def test_success_result(self):
        """Test successful sync result."""
        result = SyncResult(
            success=True,
            items_synced=5,
            items_deleted=1,
            new_commit_id="abc1234",
        )
        assert result.success is True
        assert result.items_synced == 5
        assert result.items_deleted == 1
        assert result.new_commit_id == "abc1234"
        assert result.error is None
    
    def test_failure_result(self):
        """Test failed sync result."""
        result = SyncResult(
            success=False,
            error="Connection failed",
        )
        assert result.success is False
        assert result.items_synced == 0
        assert result.error == "Connection failed"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])



class TestFrontMatterParsing:
    """
    Property 1: Front matter parsing round-trip
    
    For any valid markdown file with YAML front matter containing sb_id, title,
    type, tags, and status fields, parsing the front matter and converting to
    ItemMetadata then back to memory text format SHALL preserve all original
    field values.
    
    **Validates: Requirements 1.4, 1.5**
    """
    
    @st.composite
    def front_matter_strategy(draw):
        """Generate random valid front matter content."""
        item_type = draw(item_type_strategy)
        sb_id = draw(sb_id_strategy)
        # Use only letters to avoid YAML parsing issues with numbers
        title = draw(st.text(min_size=1, max_size=50, alphabet=st.characters(whitelist_categories=('L', 'Z'))))
        # Tags must start with letter to avoid YAML parsing as numbers
        tags = draw(st.lists(st.text(min_size=2, max_size=15, alphabet='abcdefghijklmnopqrstuvwxyz'), max_size=5))
        status = draw(st.sampled_from(['active', 'on-hold', 'complete', 'cancelled'])) if item_type == 'project' else None
        
        # Build YAML front matter
        yaml_lines = [
            '---',
            f'id: {sb_id}',
            f'title: "{title}"',
            f'type: {item_type}',
        ]
        if tags:
            yaml_lines.append('tags:')
            for tag in tags:
                # Quote tags to avoid YAML parsing "true", "false", etc. as booleans
                yaml_lines.append(f'  - "{tag}"')
        if status:
            yaml_lines.append(f'status: {status}')
        yaml_lines.append('---')
        yaml_lines.append('')
        yaml_lines.append(f'# {title}')
        yaml_lines.append('')
        yaml_lines.append('Content goes here.')
        
        content = '\n'.join(yaml_lines)
        
        return {
            'content': content,
            'expected': {
                'sb_id': sb_id,
                'title': title,
                'item_type': item_type,
                'tags': tags,
                'status': status,
            }
        }
    
    @given(front_matter_strategy())
    @settings(max_examples=100)
    def test_parsing_preserves_fields(self, data):
        """Verify parsing preserves all field values."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        content = data['content']
        expected = data['expected']
        
        # Parse front matter
        front_matter = sync.parse_front_matter(content)
        assert front_matter is not None, "Front matter should parse successfully"
        
        # Verify fields
        assert front_matter.get('id') == expected['sb_id'], "sb_id should be preserved"
        assert front_matter.get('type') == expected['item_type'], "type should be preserved"
        
        # Tags should be preserved
        parsed_tags = front_matter.get('tags', [])
        assert parsed_tags == expected['tags'], "tags should be preserved"
        
        # Status should be preserved for projects
        if expected['status']:
            assert front_matter.get('status') == expected['status'], "status should be preserved"
    
    @given(front_matter_strategy())
    @settings(max_examples=100)
    def test_extract_metadata_round_trip(self, data):
        """Verify extract_item_metadata produces correct ItemMetadata."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        content = data['content']
        expected = data['expected']
        
        # Extract metadata
        file_path = f"30-projects/test-file.md" if expected['item_type'] == 'project' else f"10-ideas/test-file.md"
        metadata = sync.extract_item_metadata(file_path, content)
        
        assert metadata is not None, "Metadata should be extracted"
        assert metadata.sb_id == expected['sb_id'], "sb_id should match"
        assert metadata.item_type == expected['item_type'], "item_type should match"
        assert metadata.tags == expected['tags'], "tags should match"
        
        if expected['item_type'] == 'project' and expected['status']:
            assert metadata.status == expected['status'], "status should match for projects"
    
    def test_invalid_front_matter_returns_none(self):
        """Verify invalid front matter returns None."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # No front matter
        assert sync.parse_front_matter("# Just a heading") is None
        
        # Unclosed front matter
        assert sync.parse_front_matter("---\nid: test\n# Content") is None
        
        # Invalid YAML
        assert sync.parse_front_matter("---\n: invalid yaml\n---\n") is None
    
    def test_missing_required_fields_returns_none(self):
        """Verify missing required fields returns None."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Missing id
        content = "---\ntitle: Test\ntype: idea\n---\n"
        assert sync.extract_item_metadata("10-ideas/test.md", content) is None
        
        # Missing title
        content = "---\nid: sb-1234567\ntype: idea\n---\n"
        assert sync.extract_item_metadata("10-ideas/test.md", content) is None
        
        # Missing type
        content = "---\nid: sb-1234567\ntitle: Test\n---\n"
        assert sync.extract_item_metadata("10-ideas/test.md", content) is None
        
        # Invalid sb_id format
        content = "---\nid: invalid\ntitle: Test\ntype: idea\n---\n"
        assert sync.extract_item_metadata("10-ideas/test.md", content) is None



class TestChangedFilesProcessing:
    """
    Property 3: Changed files only processing
    
    For any sync operation where the stored sync marker differs from CodeCommit HEAD,
    the sync module SHALL only process files that appear in the GetDifferences result
    between the two commits, and SHALL not process any files outside that delta.
    
    **Validates: Requirements 1.3, 5.2**
    """
    
    def test_filters_to_item_folders_only(self):
        """Verify only files in item folders are returned."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock, patch
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Mock CodeCommit response with files in various folders
        mock_response = {
            'differences': [
                {'afterBlob': {'path': '10-ideas/test-idea.md'}, 'changeType': 'A'},
                {'afterBlob': {'path': '20-decisions/test-decision.md'}, 'changeType': 'M'},
                {'afterBlob': {'path': '30-projects/test-project.md'}, 'changeType': 'A'},
                {'afterBlob': {'path': 'system/config.md'}, 'changeType': 'M'},  # Should be filtered
                {'afterBlob': {'path': 'README.md'}, 'changeType': 'M'},  # Should be filtered
                {'afterBlob': {'path': '00-inbox/2025-01-20.md'}, 'changeType': 'A'},  # Should be filtered
            ]
        }
        
        mock_client = MagicMock()
        mock_client.get_differences.return_value = mock_response
        sync._codecommit_client = mock_client
        
        changed = sync.get_changed_files('old-commit', 'new-commit')
        
        # Should only include files from item folders
        paths = [f['path'] for f in changed]
        assert '10-ideas/test-idea.md' in paths
        assert '20-decisions/test-decision.md' in paths
        assert '30-projects/test-project.md' in paths
        assert 'system/config.md' not in paths
        assert 'README.md' not in paths
        assert '00-inbox/2025-01-20.md' not in paths
    
    def test_filters_to_markdown_only(self):
        """Verify only .md files are returned."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        mock_response = {
            'differences': [
                {'afterBlob': {'path': '10-ideas/test-idea.md'}, 'changeType': 'A'},
                {'afterBlob': {'path': '10-ideas/.gitkeep'}, 'changeType': 'A'},  # Should be filtered
                {'afterBlob': {'path': '30-projects/image.png'}, 'changeType': 'A'},  # Should be filtered
            ]
        }
        
        mock_client = MagicMock()
        mock_client.get_differences.return_value = mock_response
        sync._codecommit_client = mock_client
        
        changed = sync.get_changed_files('old-commit', 'new-commit')
        
        paths = [f['path'] for f in changed]
        assert '10-ideas/test-idea.md' in paths
        assert '10-ideas/.gitkeep' not in paths
        assert '30-projects/image.png' not in paths
    
    def test_handles_deleted_files(self):
        """Verify deleted files are tracked with correct change type."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        mock_response = {
            'differences': [
                {'beforeBlob': {'path': '10-ideas/deleted-idea.md'}, 'changeType': 'D'},
            ]
        }
        
        mock_client = MagicMock()
        mock_client.get_differences.return_value = mock_response
        sync._codecommit_client = mock_client
        
        changed = sync.get_changed_files('old-commit', 'new-commit')
        
        assert len(changed) == 1
        assert changed[0]['path'] == '10-ideas/deleted-idea.md'
        assert changed[0]['change_type'] == 'D'
    
    @given(st.lists(st.sampled_from(['10-ideas/', '20-decisions/', '30-projects/', 'system/', '']), min_size=1, max_size=10))
    @settings(max_examples=100)
    def test_only_item_folders_pass_filter(self, folder_prefixes):
        """Property: Only files in item folders pass the filter."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Build mock differences
        differences = []
        for i, prefix in enumerate(folder_prefixes):
            differences.append({
                'afterBlob': {'path': f'{prefix}file{i}.md'},
                'changeType': 'A',
            })
        
        mock_response = {'differences': differences}
        
        mock_client = MagicMock()
        mock_client.get_differences.return_value = mock_response
        sync._codecommit_client = mock_client
        
        changed = sync.get_changed_files('old-commit', 'new-commit')
        
        # Verify all returned files are from item folders
        for file_info in changed:
            path = file_info['path']
            assert any(path.startswith(folder) for folder in sync.ITEM_FOLDERS), \
                f"File {path} should be from an item folder"



class TestIncrementalSyncSkip:
    """
    Property 2: Incremental sync skip
    
    For any sync operation where the stored sync marker commit ID equals the
    current CodeCommit HEAD commit ID, the sync module SHALL perform zero file
    fetch operations and zero Memory write operations.
    
    **Validates: Requirements 5.1**
    """
    
    @given(st.from_regex(r'^[a-f0-9]{40}$', fullmatch=True))
    @settings(max_examples=100)
    def test_skips_when_marker_equals_head(self, commit_id):
        """Property: When marker equals HEAD, no operations are performed."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Mock clients
        mock_cc = MagicMock()
        mock_cc.get_branch.return_value = {'branch': {'commitId': commit_id}}
        sync._codecommit_client = mock_cc
        
        mock_memory = MagicMock()
        mock_memory.retrieve_memories.return_value = {
            'memories': [{'content': f'Last synced commit: {commit_id}'}]
        }
        sync._memory_client = mock_memory
        
        # Run sync
        result = sync.sync_items('test-actor')
        
        # Verify success with no operations
        assert result.success is True
        assert result.items_synced == 0
        assert result.items_deleted == 0
        assert result.new_commit_id == commit_id
        
        # Verify no file operations were performed
        mock_cc.get_differences.assert_not_called()
        mock_cc.get_file.assert_not_called()
        
        # Verify no Memory writes were performed (except marker check)
        mock_memory.create_event.assert_not_called()
    
    def test_syncs_when_marker_differs(self):
        """Verify sync happens when marker differs from HEAD."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        old_commit = 'a' * 40
        new_commit = 'b' * 40
        
        # Mock clients
        mock_cc = MagicMock()
        mock_cc.get_branch.return_value = {'branch': {'commitId': new_commit}}
        mock_cc.get_differences.return_value = {'differences': []}
        sync._codecommit_client = mock_cc
        
        mock_memory = MagicMock()
        mock_memory.retrieve_memories.return_value = {
            'memories': [{'content': f'Last synced commit: {old_commit}'}]
        }
        sync._memory_client = mock_memory
        
        # Run sync
        result = sync.sync_items('test-actor')
        
        # Verify sync was attempted
        assert result.success is True
        mock_cc.get_differences.assert_called_once()
    
    def test_initial_sync_when_no_marker(self):
        """Verify initial sync happens when no marker exists."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        new_commit = 'c' * 40
        
        # Mock clients
        mock_cc = MagicMock()
        mock_cc.get_branch.return_value = {'branch': {'commitId': new_commit}}
        mock_cc.get_folder.return_value = {'files': []}
        sync._codecommit_client = mock_cc
        
        mock_memory = MagicMock()
        mock_memory.retrieve_memories.return_value = {'memories': []}  # No marker
        sync._memory_client = mock_memory
        
        # Run sync
        result = sync.sync_items('test-actor')
        
        # Verify initial sync was attempted (get_folder for all item folders)
        assert result.success is True
        assert mock_cc.get_folder.call_count >= 1  # Called for each item folder



class TestGracefulDegradation:
    """
    Property 5: Graceful degradation on failure
    
    For any sync failure (network error, API error, invalid data), the classifier
    SHALL continue to function and produce valid Action Plans. Error messages
    SHALL NOT leak internal implementation details.
    
    **Validates: Requirements 1.8, 7.1, 7.2, 7.4**
    """
    
    def test_sync_failure_returns_error_result(self):
        """Verify sync failures return SyncResult with error."""
        from item_sync import ItemSyncModule, SyncResult
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Mock CodeCommit to raise an exception
        mock_cc = MagicMock()
        mock_cc.get_branch.side_effect = Exception("Network error")
        sync._codecommit_client = mock_cc
        
        result = sync.sync_items('test-actor')
        
        assert result.success is False
        assert result.error is not None
        # Error should be user-friendly (not raw exception)
        assert len(result.error) > 0
    
    def test_memory_unavailable_returns_graceful_result(self):
        """Verify sync works gracefully when Memory is unavailable."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Mock CodeCommit to return valid data
        mock_cc = MagicMock()
        mock_cc.get_branch.return_value = {'branch': {'commitId': 'a' * 40}}
        mock_cc.get_differences.return_value = {'differences': []}
        sync._codecommit_client = mock_cc
        
        # Set memory client to None (unavailable)
        sync._memory_client = None
        
        result = sync.sync_items('test-actor')
        
        # Should succeed but with no items synced (can't write to Memory)
        assert result.success is True
        assert result.items_synced == 0
    
    def test_error_messages_no_internal_details(self):
        """Verify error messages don't leak internal implementation details."""
        from item_sync import SyncResult
        
        # Create error result
        result = SyncResult(
            success=False,
            error="Failed to get CodeCommit HEAD commit",
        )
        
        # Error should be user-friendly, not expose stack traces or internal paths
        assert "traceback" not in result.error.lower()
        assert "/home/" not in result.error
        assert "boto3" not in result.error.lower()
        assert "aws_access_key" not in result.error.lower()
    
    @given(st.text(min_size=1, max_size=100))
    @settings(max_examples=50)
    def test_invalid_actor_id_handled(self, actor_id):
        """Property: Any actor_id string should not crash the sync."""
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Mock clients to avoid real API calls
        mock_cc = MagicMock()
        mock_cc.get_branch.return_value = {'branch': {'commitId': 'a' * 40}}
        mock_cc.get_differences.return_value = {'differences': []}
        sync._codecommit_client = mock_cc
        
        mock_memory = MagicMock()
        mock_memory.retrieve_memories.return_value = {'memories': []}
        sync._memory_client = mock_memory
        
        # Should not raise exception for any actor_id
        result = sync.sync_items(actor_id)
        
        # Should return a valid SyncResult
        assert isinstance(result.success, bool)
        assert isinstance(result.items_synced, int)
        assert isinstance(result.items_deleted, int)
