/**
 * Project Status Updater Component
 * 
 * Handles project status updates by parsing and updating front matter.
 * Preserves all other content when updating status field.
 * 
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import type { ProjectStatus } from './action-plan';
import { VALID_PROJECT_STATUSES } from './action-plan';
import {
  readFile,
  writeFile,
  getLatestCommitId,
  type KnowledgeStoreConfig,
} from './knowledge-store';

// Configuration (reuses KnowledgeStoreConfig)
export type ProjectStatusUpdaterConfig = KnowledgeStoreConfig;

// Result of status update operation
export interface StatusUpdateResult {
  success: boolean;
  commitId?: string;
  error?: string;
  previousStatus?: ProjectStatus;
  newStatus?: ProjectStatus;
}

// Parsed front matter result
export interface ParsedFrontMatter {
  frontMatter: Record<string, unknown>;
  body: string;
  raw: string;
}

/**
 * Parse front matter from markdown content
 * 
 * Handles YAML front matter delimited by --- markers.
 * Returns empty front matter if none found or malformed.
 * 
 * Validates: Requirements 4.2, 4.3
 */
export function parseFrontMatter(content: string): ParsedFrontMatter {
  const result: ParsedFrontMatter = {
    frontMatter: {},
    body: content,
    raw: '',
  };

  // Check for front matter delimiter
  if (!content.startsWith('---')) {
    return result;
  }

  // Find closing delimiter
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return result;
  }

  // Extract raw front matter (between delimiters)
  const rawFrontMatter = content.slice(4, endIndex).trim();
  result.raw = rawFrontMatter;

  // Extract body (after closing delimiter)
  result.body = content.slice(endIndex + 4).trimStart();

  // Parse YAML-like front matter (simple key: value parsing)
  const lines = rawFrontMatter.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;

    // Check for array item
    if (trimmed.startsWith('- ') && currentKey && currentArray !== null) {
      currentArray.push(trimmed.slice(2).trim());
      continue;
    }

    // Save previous array if we're moving to a new key
    if (currentKey && currentArray !== null) {
      result.frontMatter[currentKey] = currentArray;
      currentArray = null;
    }

    // Check for key: value pair
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      currentKey = key;

      // Check if this starts an array (empty value followed by array items)
      if (!value) {
        currentArray = [];
        continue;
      }

      // Handle quoted strings
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        // Unescape escaped quotes within the string
        const unquoted = value.slice(1, -1);
        result.frontMatter[key] = unquoted.replace(/\\"/g, '"').replace(/\\'/g, "'");
      } else {
        result.frontMatter[key] = value;
      }
    }
  }

  // Save final array if present
  if (currentKey && currentArray !== null) {
    result.frontMatter[currentKey] = currentArray;
  }

  return result;
}

/**
 * Serialize front matter back to YAML format
 * 
 * Preserves field order and formatting.
 * 
 * Validates: Requirements 4.2, 4.3
 */
export function serializeFrontMatter(
  frontMatter: Record<string, unknown>,
  body: string
): string {
  const lines: string[] = ['---'];

  for (const [key, value] of Object.entries(frontMatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else if (typeof value === 'string') {
      // Quote strings that contain special characters
      if (value.includes(':') || value.includes('#') || value.includes('"')) {
        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push('---');
  
  // Add body with proper spacing
  if (body) {
    return lines.join('\n') + '\n' + body;
  }
  
  return lines.join('\n') + '\n';
}

/**
 * Validate project status value
 */
export function isValidProjectStatus(status: unknown): status is ProjectStatus {
  return typeof status === 'string' && 
    VALID_PROJECT_STATUSES.includes(status as ProjectStatus);
}

/**
 * Update a project's status in its front matter
 * 
 * Reads the project file, updates the status field, and commits.
 * Preserves all other front matter fields and body content.
 * 
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */
export async function updateProjectStatus(
  config: ProjectStatusUpdaterConfig,
  projectPath: string,
  newStatus: ProjectStatus,
  projectTitle?: string
): Promise<StatusUpdateResult> {
  // Validate status
  if (!isValidProjectStatus(newStatus)) {
    return {
      success: false,
      error: `Invalid status: ${newStatus}. Must be one of: ${VALID_PROJECT_STATUSES.join(', ')}`,
    };
  }

  try {
    // Read current file content
    const content = await readFile(config, projectPath);
    if (!content) {
      return {
        success: false,
        error: `Project file not found: ${projectPath}`,
      };
    }

    // Parse front matter
    const parsed = parseFrontMatter(content);
    
    // Get previous status (default to 'active' if not set)
    const previousStatus = isValidProjectStatus(parsed.frontMatter.status)
      ? parsed.frontMatter.status
      : 'active';

    // If status is already the target value, return success without committing
    if (previousStatus === newStatus) {
      return {
        success: true,
        previousStatus,
        newStatus,
        // No commitId - nothing changed
      };
    }

    // Update status
    parsed.frontMatter.status = newStatus;

    // Serialize back to markdown
    const updatedContent = serializeFrontMatter(parsed.frontMatter, parsed.body);

    // Get parent commit for write
    const parentCommitId = await getLatestCommitId(config);

    // Generate commit message with project name and new status
    const title = projectTitle || parsed.frontMatter.title || 'Unknown Project';
    const commitMessage = `Update ${title} status to ${newStatus}`;

    // Write updated file
    const result = await writeFile(
      config,
      { path: projectPath, content: updatedContent, mode: 'update' },
      commitMessage,
      parentCommitId
    );

    return {
      success: true,
      commitId: result.commitId,
      previousStatus,
      newStatus,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
