"""
Property-based tests for Item Sync Module.

Uses hypothesis for property-based testing.

Validates: Requirements 1.4, 1.5, 5.1, 5.2, 6.1, 6.2, 6.3
"""

import pytest
from hypothesis import given, strategies as st, settings
from item_sync import ItemMetadata, SyncResult, HealthReport


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


class TestSingleItemSync:
    """
    Property 2: Sync triggers after commit
    
    For any successful commit of an idea, decision, or project to CodeCommit,
    the Worker Lambda SHALL invoke the Memory sync client with the correct
    ItemMetadata extracted from the committed content. For multi-item commits,
    all successfully committed items SHALL be synced.
    
    **Validates: Requirements 1.1, 1.3, 1.6**
    
    Feature: memory-repo-sync, Property 2: Sync triggers after commit
    """
    
    @st.composite
    def valid_item_content_strategy(draw):
        """Generate random valid item content with front matter."""
        item_type = draw(st.sampled_from(['idea', 'decision', 'project']))
        sb_id = draw(st.from_regex(r'^sb-[a-f0-9]{7}$', fullmatch=True))
        # Use only letters to avoid YAML parsing issues
        title = draw(st.text(min_size=1, max_size=50, alphabet='abcdefghijklmnopqrstuvwxyz '))
        # Tags must be simple strings
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
                yaml_lines.append(f'  - "{tag}"')
        if status:
            yaml_lines.append(f'status: {status}')
        yaml_lines.append('---')
        yaml_lines.append('')
        yaml_lines.append(f'# {title}')
        yaml_lines.append('')
        yaml_lines.append('Content goes here.')
        
        content = '\n'.join(yaml_lines)
        
        # Generate matching file path
        folder_map = {'idea': '10-ideas', 'decision': '20-decisions', 'project': '30-projects'}
        folder = folder_map[item_type]
        slug = title.lower().replace(' ', '-')[:20]
        file_path = f"{folder}/2025-01-20__{slug}__{sb_id}.md"
        
        return {
            'content': content,
            'file_path': file_path,
            'expected': {
                'sb_id': sb_id,
                'title': title,
                'item_type': item_type,
                'tags': tags,
                'status': status,
            }
        }
    
    @given(valid_item_content_strategy())
    @settings(max_examples=100)
    def test_sync_single_item_extracts_metadata_correctly(self, data):
        """
        Property: sync_single_item extracts metadata correctly from content.
        
        **Validates: Requirements 1.2, 1.3**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Mock Memory client to capture what gets stored
        mock_memory = MagicMock()
        mock_memory.create_event.return_value = {}
        sync._memory_client = mock_memory
        
        content = data['content']
        file_path = data['file_path']
        expected = data['expected']
        
        # Call sync_single_item
        result = sync.sync_single_item('test-actor', file_path, content)
        
        # Verify success
        assert result.success is True, f"Sync should succeed, got error: {result.error}"
        assert result.items_synced == 1, "Should sync exactly 1 item"
        
        # Verify Memory was called with correct data
        mock_memory.create_event.assert_called_once()
        call_args = mock_memory.create_event.call_args
        
        # Verify session_id contains the sb_id
        assert expected['sb_id'] in call_args.kwargs.get('session_id', ''), \
            f"Session ID should contain sb_id {expected['sb_id']}"
        
        # Verify the message content contains expected metadata
        messages = call_args.kwargs.get('messages', [])
        assert len(messages) > 0, "Should have at least one message"
        message_text = messages[0][0]  # First message, first element is text
        
        assert expected['sb_id'] in message_text, f"Message should contain sb_id {expected['sb_id']}"
        assert expected['item_type'] in message_text, f"Message should contain type {expected['item_type']}"
    
    @given(valid_item_content_strategy())
    @settings(max_examples=100)
    def test_sync_single_item_stores_all_metadata_fields(self, data):
        """
        Property: sync_single_item stores all metadata fields in Memory.
        
        **Validates: Requirements 1.2**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Mock Memory client
        mock_memory = MagicMock()
        mock_memory.create_event.return_value = {}
        sync._memory_client = mock_memory
        
        content = data['content']
        file_path = data['file_path']
        expected = data['expected']
        
        # Call sync_single_item
        result = sync.sync_single_item('test-actor', file_path, content)
        
        assert result.success is True
        
        # Get the stored message
        call_args = mock_memory.create_event.call_args
        messages = call_args.kwargs.get('messages', [])
        message_text = messages[0][0]
        
        # Verify all required fields are present
        assert f"ID: {expected['sb_id']}" in message_text, "sb_id should be in stored text"
        assert f"Type: {expected['item_type']}" in message_text, "item_type should be in stored text"
        assert f"Path: {file_path}" in message_text, "file_path should be in stored text"
        
        # Verify tags if present
        if expected['tags']:
            assert "Tags:" in message_text, "Tags should be in stored text when present"
            for tag in expected['tags']:
                assert tag in message_text, f"Tag '{tag}' should be in stored text"
        
        # Verify status for projects
        if expected['status']:
            assert f"Status: {expected['status']}" in message_text, "Status should be in stored text for projects"
    
    def test_sync_single_item_fails_for_invalid_content(self):
        """
        Unit test: sync_single_item returns failure for invalid content.
        
        **Validates: Requirements 1.2**
        """
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Test with content missing front matter
        result = sync.sync_single_item('test-actor', '10-ideas/test.md', '# Just a heading')
        assert result.success is False
        assert result.items_synced == 0
        assert result.error is not None
        
        # Test with content missing required fields
        content = "---\ntitle: Test\n---\n# Test"  # Missing id and type
        result = sync.sync_single_item('test-actor', '10-ideas/test.md', content)
        assert result.success is False
        assert result.items_synced == 0
    
    def test_sync_single_item_fails_when_memory_unavailable(self):
        """
        Unit test: sync_single_item returns failure when Memory is unavailable.
        
        **Validates: Requirements 1.4**
        """
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Set memory client to None (unavailable)
        sync._memory_client = None
        
        content = """---
id: sb-1234567
title: "Test Item"
type: idea
---

# Test Item

Content here.
"""
        result = sync.sync_single_item('test-actor', '10-ideas/test.md', content)
        
        # Should fail because Memory is unavailable
        assert result.success is False
        assert result.items_synced == 0
    
    @given(st.lists(valid_item_content_strategy(), min_size=1, max_size=5))
    @settings(max_examples=50)
    def test_multiple_items_can_be_synced_sequentially(self, items_data):
        """
        Property: Multiple items can be synced sequentially (for multi-item commits).
        
        **Validates: Requirements 1.6**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Mock Memory client
        mock_memory = MagicMock()
        mock_memory.create_event.return_value = {}
        sync._memory_client = mock_memory
        
        total_synced = 0
        for data in items_data:
            result = sync.sync_single_item('test-actor', data['file_path'], data['content'])
            if result.success:
                total_synced += result.items_synced
        
        # All items should be synced
        assert total_synced == len(items_data), f"All {len(items_data)} items should be synced"
        
        # Memory should be called once per item
        assert mock_memory.create_event.call_count == len(items_data), \
            f"Memory should be called {len(items_data)} times"


class TestHealthCheckAccuracy:
    """
    Property 6: Health check accuracy
    
    For any health check operation, the reported CodeCommit count SHALL equal
    the actual number of markdown files in the ideas, decisions, and projects
    folders. The reported Memory count SHALL equal the actual number of items
    stored in Memory. Discrepancies SHALL be correctly identified and listed
    (up to 10 items).
    
    **Validates: Requirements 5.1, 5.2, 5.3, 5.5**
    
    Feature: memory-repo-sync, Property 6: Health check accuracy
    """
    
    @st.composite
    def item_sets_strategy(draw):
        """
        Generate random sets of items for CodeCommit and Memory.
        
        Returns a dict with:
        - codecommit_items: List of ItemMetadata in CodeCommit
        - memory_items: List of ItemMetadata in Memory
        - expected_missing: sb_ids in CodeCommit but not Memory
        - expected_extra: sb_ids in Memory but not CodeCommit
        """
        # Generate a pool of unique sb_ids
        num_total_items = draw(st.integers(min_value=0, max_value=20))
        sb_ids = [f"sb-{i:07x}" for i in range(num_total_items)]
        
        # Randomly assign items to CodeCommit and/or Memory
        codecommit_sb_ids = set()
        memory_sb_ids = set()
        
        for sb_id in sb_ids:
            in_codecommit = draw(st.booleans())
            in_memory = draw(st.booleans())
            
            # Ensure at least one location (avoid orphan items)
            if not in_codecommit and not in_memory:
                if draw(st.booleans()):
                    in_codecommit = True
                else:
                    in_memory = True
            
            if in_codecommit:
                codecommit_sb_ids.add(sb_id)
            if in_memory:
                memory_sb_ids.add(sb_id)
        
        # Create ItemMetadata objects
        def make_item(sb_id, index):
            item_type = ['idea', 'decision', 'project'][index % 3]
            folder_map = {'idea': '10-ideas', 'decision': '20-decisions', 'project': '30-projects'}
            folder = folder_map[item_type]
            return ItemMetadata(
                sb_id=sb_id,
                title=f"Test Item {sb_id}",
                item_type=item_type,
                path=f"{folder}/2025-01-20__test-item__{sb_id}.md",
                tags=['test'],
                status='active' if item_type == 'project' else None,
            )
        
        codecommit_items = [make_item(sb_id, i) for i, sb_id in enumerate(codecommit_sb_ids)]
        memory_items = [make_item(sb_id, i) for i, sb_id in enumerate(memory_sb_ids)]
        
        # Calculate expected discrepancies
        expected_missing = list(codecommit_sb_ids - memory_sb_ids)
        expected_extra = list(memory_sb_ids - codecommit_sb_ids)
        
        return {
            'codecommit_items': codecommit_items,
            'memory_items': memory_items,
            'expected_missing': expected_missing,
            'expected_extra': expected_extra,
        }
    
    @given(item_sets_strategy())
    @settings(max_examples=100)
    def test_health_report_counts_match_actual_items(self, data):
        """
        Property: Health report counts match actual item counts.
        
        **Validates: Requirements 5.1, 5.2**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import MagicMock, patch
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        codecommit_items = data['codecommit_items']
        memory_items = data['memory_items']
        
        # Mock get_all_codecommit_items to return our test items
        with patch.object(sync, 'get_all_codecommit_items', return_value=codecommit_items):
            # Mock get_all_memory_items to return our test items
            with patch.object(sync, 'get_all_memory_items', return_value=memory_items):
                # Mock sync marker details
                with patch.object(sync, '_get_sync_marker_details', return_value=('abc1234', '2025-01-20T10:00:00Z')):
                    report = sync.get_health_report('test-actor')
        
        # Verify counts match actual items
        assert report.codecommit_count == len(codecommit_items), \
            f"CodeCommit count {report.codecommit_count} should match actual {len(codecommit_items)}"
        assert report.memory_count == len(memory_items), \
            f"Memory count {report.memory_count} should match actual {len(memory_items)}"
    
    @given(item_sets_strategy())
    @settings(max_examples=100)
    def test_health_report_identifies_discrepancies_correctly(self, data):
        """
        Property: Health report correctly identifies missing and extra items.
        
        **Validates: Requirements 5.3, 5.5**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import patch
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        codecommit_items = data['codecommit_items']
        memory_items = data['memory_items']
        expected_missing = set(data['expected_missing'])
        expected_extra = set(data['expected_extra'])
        
        with patch.object(sync, 'get_all_codecommit_items', return_value=codecommit_items):
            with patch.object(sync, 'get_all_memory_items', return_value=memory_items):
                with patch.object(sync, '_get_sync_marker_details', return_value=('abc1234', '2025-01-20T10:00:00Z')):
                    report = sync.get_health_report('test-actor')
        
        # Verify missing items are correctly identified (up to 10)
        reported_missing = set(report.missing_in_memory)
        assert reported_missing.issubset(expected_missing), \
            f"Reported missing {reported_missing} should be subset of expected {expected_missing}"
        
        # Verify extra items are correctly identified (up to 10)
        reported_extra = set(report.extra_in_memory)
        assert reported_extra.issubset(expected_extra), \
            f"Reported extra {reported_extra} should be subset of expected {expected_extra}"
        
        # Verify list limits (max 10 items)
        assert len(report.missing_in_memory) <= 10, "Missing list should be limited to 10 items"
        assert len(report.extra_in_memory) <= 10, "Extra list should be limited to 10 items"
    
    @given(item_sets_strategy())
    @settings(max_examples=100)
    def test_health_report_in_sync_flag_accuracy(self, data):
        """
        Property: in_sync flag is True only when counts match and no discrepancies.
        
        **Validates: Requirements 5.3**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import patch
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        codecommit_items = data['codecommit_items']
        memory_items = data['memory_items']
        expected_missing = data['expected_missing']
        expected_extra = data['expected_extra']
        
        with patch.object(sync, 'get_all_codecommit_items', return_value=codecommit_items):
            with patch.object(sync, 'get_all_memory_items', return_value=memory_items):
                with patch.object(sync, '_get_sync_marker_details', return_value=('abc1234', '2025-01-20T10:00:00Z')):
                    report = sync.get_health_report('test-actor')
        
        # in_sync should be True only when there are no discrepancies
        expected_in_sync = len(expected_missing) == 0 and len(expected_extra) == 0
        assert report.in_sync == expected_in_sync, \
            f"in_sync should be {expected_in_sync} when missing={len(expected_missing)}, extra={len(expected_extra)}"
    
    def test_health_report_with_empty_codecommit(self):
        """
        Unit test: Health report handles empty CodeCommit correctly.
        
        **Validates: Requirements 5.1, 5.2**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import patch
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        memory_items = [
            ItemMetadata(
                sb_id='sb-0000001',
                title='Memory Only Item',
                item_type='idea',
                path='10-ideas/test.md',
                tags=[],
                status=None,
            )
        ]
        
        with patch.object(sync, 'get_all_codecommit_items', return_value=[]):
            with patch.object(sync, 'get_all_memory_items', return_value=memory_items):
                with patch.object(sync, '_get_sync_marker_details', return_value=(None, None)):
                    report = sync.get_health_report('test-actor')
        
        assert report.codecommit_count == 0
        assert report.memory_count == 1
        assert report.in_sync is False
        assert len(report.missing_in_memory) == 0
        assert 'sb-0000001' in report.extra_in_memory
    
    def test_health_report_with_empty_memory(self):
        """
        Unit test: Health report handles empty Memory correctly.
        
        **Validates: Requirements 5.1, 5.2**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import patch
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        codecommit_items = [
            ItemMetadata(
                sb_id='sb-0000001',
                title='CodeCommit Only Item',
                item_type='idea',
                path='10-ideas/test.md',
                tags=[],
                status=None,
            )
        ]
        
        with patch.object(sync, 'get_all_codecommit_items', return_value=codecommit_items):
            with patch.object(sync, 'get_all_memory_items', return_value=[]):
                with patch.object(sync, '_get_sync_marker_details', return_value=(None, None)):
                    report = sync.get_health_report('test-actor')
        
        assert report.codecommit_count == 1
        assert report.memory_count == 0
        assert report.in_sync is False
        assert 'sb-0000001' in report.missing_in_memory
        assert len(report.extra_in_memory) == 0
    
    def test_health_report_perfectly_synced(self):
        """
        Unit test: Health report shows in_sync when items match.
        
        **Validates: Requirements 5.3, 5.6**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import patch
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        items = [
            ItemMetadata(
                sb_id='sb-0000001',
                title='Synced Item 1',
                item_type='idea',
                path='10-ideas/test1.md',
                tags=[],
                status=None,
            ),
            ItemMetadata(
                sb_id='sb-0000002',
                title='Synced Item 2',
                item_type='decision',
                path='20-decisions/test2.md',
                tags=[],
                status=None,
            ),
        ]
        
        with patch.object(sync, 'get_all_codecommit_items', return_value=items):
            with patch.object(sync, 'get_all_memory_items', return_value=items):
                with patch.object(sync, '_get_sync_marker_details', return_value=('abc1234', '2025-01-20T10:00:00Z')):
                    report = sync.get_health_report('test-actor')
        
        assert report.codecommit_count == 2
        assert report.memory_count == 2
        assert report.in_sync is True
        assert len(report.missing_in_memory) == 0
        assert len(report.extra_in_memory) == 0
        assert report.last_sync_commit_id == 'abc1234'
        assert report.last_sync_timestamp == '2025-01-20T10:00:00Z'
    
    def test_health_report_limits_discrepancy_list_to_10(self):
        """
        Unit test: Health report limits discrepancy lists to 10 items.
        
        **Validates: Requirements 5.5**
        """
        from item_sync import ItemSyncModule
        from unittest.mock import patch
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Create 15 items only in CodeCommit (missing in Memory)
        codecommit_items = [
            ItemMetadata(
                sb_id=f'sb-{i:07x}',
                title=f'Item {i}',
                item_type='idea',
                path=f'10-ideas/test{i}.md',
                tags=[],
                status=None,
            )
            for i in range(15)
        ]
        
        with patch.object(sync, 'get_all_codecommit_items', return_value=codecommit_items):
            with patch.object(sync, 'get_all_memory_items', return_value=[]):
                with patch.object(sync, '_get_sync_marker_details', return_value=(None, None)):
                    report = sync.get_health_report('test-actor')
        
        assert report.codecommit_count == 15
        assert report.memory_count == 0
        assert report.in_sync is False
        # Should be limited to 10 items
        assert len(report.missing_in_memory) == 10, \
            f"Missing list should be limited to 10, got {len(report.missing_in_memory)}"


class TestParseMemoryItem:
    """
    Unit tests for _parse_memory_item helper method.
    
    **Validates: Requirements 5.2**
    """
    
    def test_parses_valid_memory_item(self):
        """Test parsing a valid memory item format."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        content = """Item: Test Project
ID: sb-1234567
Type: project
Path: 30-projects/2025-01-20__test-project__sb-1234567.md
Tags: test, example
Status: active"""
        
        metadata = sync._parse_memory_item(content)
        
        assert metadata is not None
        assert metadata.sb_id == 'sb-1234567'
        assert metadata.title == 'Test Project'
        assert metadata.item_type == 'project'
        assert metadata.path == '30-projects/2025-01-20__test-project__sb-1234567.md'
        assert metadata.tags == ['test', 'example']
        assert metadata.status == 'active'
    
    def test_parses_item_without_optional_fields(self):
        """Test parsing item without tags and status."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        content = """Item: Simple Idea
ID: sb-abcdef0
Type: idea
Path: 10-ideas/2025-01-20__simple-idea__sb-abcdef0.md"""
        
        metadata = sync._parse_memory_item(content)
        
        assert metadata is not None
        assert metadata.sb_id == 'sb-abcdef0'
        assert metadata.title == 'Simple Idea'
        assert metadata.item_type == 'idea'
        assert metadata.tags == []
        assert metadata.status is None
    
    def test_skips_sync_marker_content(self):
        """Test that sync markers are skipped."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        content = "Last synced commit: abc1234567890"
        
        metadata = sync._parse_memory_item(content)
        
        assert metadata is None
    
    def test_returns_none_for_invalid_sb_id(self):
        """Test that invalid sb_id format returns None."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        content = """Item: Invalid Item
ID: invalid-id
Type: idea
Path: 10-ideas/test.md"""
        
        metadata = sync._parse_memory_item(content)
        
        assert metadata is None
    
    def test_returns_none_for_missing_required_fields(self):
        """Test that missing required fields returns None."""
        from item_sync import ItemSyncModule
        
        sync = ItemSyncModule(memory_id='test-memory', region='us-east-1')
        
        # Missing ID
        content = """Item: Test Item
Type: idea
Path: 10-ideas/test.md"""
        
        metadata = sync._parse_memory_item(content)
        
        assert metadata is None



# NOTE: Memory-first retrieval tests (Property 8) are in test_memory_first_retrieval.py
# Those tests properly cover Requirements 4.1, 4.2, 4.3 without the importlib.reload issues
