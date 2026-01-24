#!/usr/bin/env python3
"""
Migrate front matter to new Obsidian-compatible format.

Changes:
- Add blank line after opening ---
- Add alias field
- Add summary field (empty)
- Add parent field (empty)
- Move tags to bottom of note as "Tags: #tag1 #tag2"
- Move links to bottom of note as "Links: [[sb-xxx]], [[sb-yyy]]"
- Add blank line before closing ---
"""

import boto3
import re
import sys

REPO_NAME = 'second-brain-knowledge'
BRANCH = 'main'

codecommit = boto3.client('codecommit', region_name='us-east-1')


def get_file_content(path: str) -> str:
    """Get file content from CodeCommit."""
    response = codecommit.get_file(
        repositoryName=REPO_NAME,
        filePath=path,
    )
    return response['fileContent'].decode('utf-8')


def get_latest_commit() -> str:
    """Get latest commit ID."""
    response = codecommit.get_branch(
        repositoryName=REPO_NAME,
        branchName=BRANCH,
    )
    return response['branch']['commitId']


def commit_file(path: str, content: str, message: str, parent_commit: str) -> str:
    """Commit a file to CodeCommit."""
    response = codecommit.create_commit(
        repositoryName=REPO_NAME,
        branchName=BRANCH,
        parentCommitId=parent_commit,
        authorName='Second Brain Migration',
        email='migration@second-brain.local',
        commitMessage=message,
        putFiles=[{
            'filePath': path,
            'fileContent': content.encode('utf-8'),
        }],
    )
    return response['commitId']


def parse_old_front_matter(content: str) -> tuple:
    """Parse old front matter and return (front_matter_dict, body)."""
    if not content.startswith('---'):
        return None, content
    
    # Find closing ---
    match = re.search(r'\n---\n', content[4:])
    if not match:
        return None, content
    
    end_idx = match.start() + 4
    yaml_block = content[4:end_idx]
    body = content[end_idx + 4:]  # Skip \n---\n
    
    # Parse YAML manually
    fm = {}
    current_key = None
    current_list = []
    
    for line in yaml_block.split('\n'):
        if not line.strip():
            continue
        
        # List item
        if line.startswith('  - '):
            value = line[4:].strip().strip('"').strip("'")
            current_list.append(value)
            continue
        
        # Save previous list
        if current_key and current_list:
            fm[current_key] = current_list
            current_list = []
        
        # Key-value pair
        match = re.match(r'^(\w+):\s*(.*)', line)
        if match:
            key = match.group(1)
            value = match.group(2).strip().strip('"').strip("'")
            
            if not value:
                current_key = key
                current_list = []
            else:
                fm[key] = value
                current_key = None
    
    # Save final list
    if current_key and current_list:
        fm[current_key] = current_list
    
    return fm, body


def generate_new_content(fm: dict, body: str) -> str:
    """Generate new content with updated front matter format."""
    lines = ['---', '']  # Opening --- with blank line after
    
    # Core fields
    lines.append(f"id: {fm.get('id', '')}")
    lines.append(f"type: {fm.get('type', '')}")
    lines.append(f"title: {fm.get('title', '')}")
    lines.append(f"alias: {fm.get('title', '')}")
    
    # Summary (empty for migration)
    lines.append('summary:')
    
    # Parent (empty for migration)
    lines.append('parent:')
    
    # Status (projects only)
    if fm.get('type') == 'project':
        lines.append(f"status: {fm.get('status', 'active')}")
    
    # Dates
    lines.append(f"created_at: {fm.get('created_at', '')}")
    if fm.get('updated_at'):
        lines.append(f"updated_at: {fm.get('updated_at')}")
    
    # Source (if present)
    if fm.get('source'):
        if isinstance(fm['source'], dict):
            lines.append('source:')
            lines.append(f"  channel: {fm['source'].get('channel', '')}")
            lines.append(f"  message_ts: {fm['source'].get('message_ts', '')}")
    
    # Extract tags and links from old front matter
    tags = fm.get('tags', [])
    links = fm.get('links', [])
    
    # Tags in front matter (for machine queries)
    if tags:
        if isinstance(tags, list):
            lines.append('tags:')
            for t in tags:
                lines.append(f'  - {t}')
        else:
            lines.append('tags:')
            lines.append(f'  - {tags}')
    else:
        lines.append('tags: []')
    
    # Links in front matter (for graph queries)
    if links:
        if isinstance(links, list):
            lines.append('links:')
            for link in links:
                lines.append(f'  - "{link}"')
        else:
            lines.append('links:')
            lines.append(f'  - "{links}"')
    
    lines.append('')  # Blank line before closing ---
    lines.append('---')
    lines.append('')
    
    # Body content
    body = body.strip()
    
    # Clean up body - remove any existing Tags/Links lines at the end
    body_lines = body.split('\n')
    while body_lines and (body_lines[-1].startswith('Tags:') or body_lines[-1].startswith('Links:') or not body_lines[-1].strip()):
        body_lines.pop()
    body = '\n'.join(body_lines)
    
    # Add body
    lines.append(body)
    
    # Add tags and links at bottom (footer for Obsidian native experience)
    if tags or links:
        lines.append('')
        lines.append('---')
    
    if tags:
        if isinstance(tags, list):
            hash_tags = ' '.join(f'#{t}' for t in tags)
        else:
            hash_tags = f'#{tags}'
        lines.append(f'Tags: {hash_tags}')
    
    if links:
        if isinstance(links, list):
            links_str = ', '.join(links)
        else:
            links_str = links
        lines.append(f'Links: {links_str}')
    
    return '\n'.join(lines)


def migrate_file(path: str) -> str:
    """Migrate a single file and return new commit ID."""
    print(f"  Migrating: {path}")
    
    content = get_file_content(path)
    
    # Skip if already has the new format (tags: in front matter section)
    # Check for tags: within first 500 chars (front matter area)
    if 'tags:' in content[:500] and 'alias:' in content[:500]:
        print(f"    Skipping (already has tags in front matter)")
        return get_latest_commit()
    
    fm, body = parse_old_front_matter(content)
    
    if not fm:
        print(f"    Skipping (no front matter)")
        return get_latest_commit()
    
    new_content = generate_new_content(fm, body)
    
    # Get fresh commit ID right before committing to avoid race condition
    parent_commit = get_latest_commit()
    
    # Commit
    new_commit = commit_file(
        path,
        new_content,
        f"Migrate front matter: {path}",
        parent_commit
    )
    
    print(f"    Done: {new_commit[:7]}")
    return new_commit


def main():
    print("Front Matter Migration")
    print("=" * 40)
    
    # Get all files to migrate
    folders = ['10-ideas', '20-decisions', '30-projects']
    files_to_migrate = []
    
    for folder in folders:
        try:
            response = codecommit.get_folder(
                repositoryName=REPO_NAME,
                folderPath=folder,
            )
            for f in response.get('files', []):
                path = f['absolutePath']
                if path.endswith('.md') and not path.endswith('.gitkeep'):
                    files_to_migrate.append(path)
        except Exception as e:
            print(f"Warning: Could not list {folder}: {e}")
    
    print(f"Found {len(files_to_migrate)} files to migrate")
    print()
    
    # Migrate each file
    for path in files_to_migrate:
        migrate_file(path)
    
    print()
    print("=" * 40)
    print("Migration complete.")


if __name__ == '__main__':
    main()
