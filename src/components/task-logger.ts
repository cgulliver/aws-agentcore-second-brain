/**
 * Task Logger Component
 * 
 * Appends task log entries to project files.
 * Creates ## Tasks section if it doesn't exist.
 * 
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

import {
  readFile,
  writeFile,
  getLatestCommitId,
  type KnowledgeStoreConfig,
} from './knowledge-store';

// Configuration (reuses KnowledgeStoreConfig)
export type TaskLoggerConfig = KnowledgeStoreConfig;

// Task log entry structure
export interface TaskLogEntry {
  date: string;  // YYYY-MM-DD format
  title: string;
}

// Result of task log operation
export interface TaskLogResult {
  success: boolean;
  commitId?: string;
  error?: string;
}

/**
 * Format a task log entry
 * 
 * Format: `- YYYY-MM-DD: <task title>`
 * 
 * Validates: Requirements 5.1, 5.2
 */
export function formatTaskLogEntry(entry: TaskLogEntry): string {
  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new Error(`Invalid date format: ${entry.date}. Expected YYYY-MM-DD`);
  }
  
  // Validate title is non-empty
  if (!entry.title || entry.title.trim().length === 0) {
    throw new Error('Task title cannot be empty');
  }
  
  // Format: - YYYY-MM-DD: <title>
  return `- ${entry.date}: ${entry.title.trim()}`;
}

/**
 * Find or create the ## Tasks section in project content
 * 
 * If no Tasks section exists, creates one before the `---` source line.
 * If no source line exists, appends to end of file.
 * 
 * Validates: Requirements 5.3
 */
export function ensureTasksSection(content: string): string {
  // Check if ## Tasks section already exists
  if (/^## Tasks\s*$/m.test(content)) {
    return content;
  }
  
  // Find the source line (--- at end of file, typically after content)
  // Look for a line that starts with "---" and is followed by "Source:"
  const sourceLineMatch = content.match(/\n---\nSource:/);
  
  if (sourceLineMatch && sourceLineMatch.index !== undefined) {
    // Insert ## Tasks section before the source line
    const beforeSource = content.slice(0, sourceLineMatch.index);
    const sourceAndAfter = content.slice(sourceLineMatch.index);
    return `${beforeSource}\n\n## Tasks\n${sourceAndAfter}`;
  }
  
  // No source line found, append to end
  return `${content.trimEnd()}\n\n## Tasks\n`;
}

/**
 * Append a task log entry to the ## Tasks section
 * 
 * Validates: Requirements 5.1, 5.2, 5.3
 */
export function appendTaskToSection(content: string, entry: TaskLogEntry): string {
  // Ensure Tasks section exists
  const contentWithSection = ensureTasksSection(content);
  
  // Format the entry
  const formattedEntry = formatTaskLogEntry(entry);
  
  // Find the ## Tasks section and append entry
  const tasksMatch = contentWithSection.match(/^## Tasks\s*$/m);
  if (!tasksMatch || tasksMatch.index === undefined) {
    // This shouldn't happen since we just ensured the section exists
    throw new Error('Failed to find Tasks section after creation');
  }
  
  const tasksIndex = tasksMatch.index + tasksMatch[0].length;
  
  // Find the next section or end of content
  const afterTasks = contentWithSection.slice(tasksIndex);
  const nextSectionMatch = afterTasks.match(/\n## |\n---\nSource:/);
  
  if (nextSectionMatch && nextSectionMatch.index !== undefined) {
    // Insert before next section
    const beforeNext = contentWithSection.slice(0, tasksIndex + nextSectionMatch.index);
    const nextAndAfter = contentWithSection.slice(tasksIndex + nextSectionMatch.index);
    return `${beforeNext}\n${formattedEntry}${nextAndAfter}`;
  }
  
  // No next section, append to end
  return `${contentWithSection.trimEnd()}\n${formattedEntry}\n`;
}

/**
 * Append a task log entry to a project file
 * 
 * Reads the project file, ensures Tasks section exists,
 * appends the formatted entry, and commits.
 * 
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */
export async function appendTaskLog(
  config: TaskLoggerConfig,
  projectPath: string,
  entry: TaskLogEntry
): Promise<TaskLogResult> {
  try {
    // Read current file content
    const content = await readFile(config, projectPath);
    if (!content) {
      return {
        success: false,
        error: `Project file not found: ${projectPath}`,
      };
    }
    
    // Append task to content
    const updatedContent = appendTaskToSection(content, entry);
    
    // Get parent commit for write
    const parentCommitId = await getLatestCommitId(config);
    
    // Generate commit message
    const commitMessage = `Log task: ${entry.title}`;
    
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
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
