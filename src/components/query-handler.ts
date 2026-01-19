/**
 * Query Handler Component
 * 
 * Handles semantic query processing and response generation.
 * 
 * Validates: Requirements 55 (Query Response Generation)
 */

import type { CitedFile, KnowledgeFile } from './knowledge-search';
import { getTopRelevantFiles, formatFilesAsContext } from './knowledge-search';
import type { ProjectStatus } from './action-plan';
import { parseFrontMatter } from './project-status-updater';

/**
 * Query processing configuration
 */
export interface QueryConfig {
  maxCitedFiles: number;
  maxExcerptLength: number;
  minRelevanceScore: number;
}

/**
 * Default query configuration
 */
export const DEFAULT_QUERY_CONFIG: QueryConfig = {
  maxCitedFiles: 5,
  maxExcerptLength: 500,
  minRelevanceScore: 0.1,
};

/**
 * Query result with response and citations
 */
export interface QueryResult {
  response: string;
  citedFiles: CitedFile[];
  hasResults: boolean;
  searchedFolders: string[];
  totalFilesSearched: number;
}

/**
 * Generate a "no results" response
 * 
 * Validates: Requirement 55.4
 */
export function generateNoResultsResponse(query: string): string {
  return `I couldn't find any relevant information in your knowledge base for "${query}". ` +
    `If you'd like to capture something about this topic, just tell me and I'll store it for you.`;
}

/**
 * Format cited files for Slack response
 */
export function formatCitationsForSlack(citedFiles: CitedFile[]): string {
  if (citedFiles.length === 0) {
    return '';
  }
  
  const citations = citedFiles.map(file => {
    const dateInfo = file.date ? ` (${file.date})` : '';
    return `• \`${file.path}\`${dateInfo}`;
  });
  
  return '\n\n*Sources:*\n' + citations.join('\n');
}

/**
 * Build the query prompt for AgentCore
 */
export function buildQueryPrompt(
  query: string,
  knowledgeContext: string,
  citedFiles: CitedFile[]
): string {
  const fileList = citedFiles.map(f => f.path).join(', ');
  
  return `You are answering a question about the user's personal knowledge base.

USER QUESTION: ${query}

KNOWLEDGE BASE CONTENT:
${knowledgeContext}

INSTRUCTIONS:
1. Answer the question based ONLY on the information provided above
2. If the information doesn't contain a clear answer, say so
3. Reference specific files when citing information
4. Be conversational and helpful
5. Include relevant dates when available
6. Do NOT make up information not present in the knowledge base

Available files: ${fileList}

Provide a helpful, conversational response:`;
}

/**
 * Process a query against the knowledge base
 * 
 * Validates: Requirements 55.1, 55.2, 55.3, 55.4, 55.5
 */
export function processQuery(
  query: string,
  files: KnowledgeFile[],
  config: QueryConfig = DEFAULT_QUERY_CONFIG
): { citedFiles: CitedFile[]; hasResults: boolean; context: string } {
  // Get relevant files
  const citedFiles = getTopRelevantFiles(
    files,
    query,
    config.maxCitedFiles,
    config.maxExcerptLength
  ).filter(f => f.relevanceScore >= config.minRelevanceScore);
  
  const hasResults = citedFiles.length > 0;
  
  // Build context from relevant files only
  const relevantFiles = files.filter(f => 
    citedFiles.some(cf => cf.path === f.path)
  );
  const context = formatFilesAsContext(relevantFiles);
  
  return {
    citedFiles,
    hasResults,
    context,
  };
}

/**
 * Validate that a response only cites files that exist
 * 
 * Validates: Requirement 55.3 (Hallucination guard)
 */
export function validateResponseCitations(
  response: string,
  citedFiles: CitedFile[]
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  // Extract file paths mentioned in response
  const pathPattern = /`([^`]+\.md)`/g;
  const mentionedPaths: string[] = [];
  let match;
  
  while ((match = pathPattern.exec(response)) !== null) {
    mentionedPaths.push(match[1]);
  }
  
  // Check each mentioned path exists in cited files
  const citedPaths = new Set(citedFiles.map(f => f.path));
  
  for (const path of mentionedPaths) {
    if (!citedPaths.has(path)) {
      warnings.push(`Response mentions file "${path}" which was not in cited files`);
    }
  }
  
  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Format query response for Slack
 */
export function formatQuerySlackReply(
  response: string,
  citedFiles: CitedFile[]
): string {
  const citations = formatCitationsForSlack(citedFiles);
  return response + citations;
}

/**
 * Determine if a message is a query based on simple heuristics
 * This is a fallback when AgentCore intent classification is not available
 */
export function isLikelyQuery(message: string): boolean {
  const queryPatterns = [
    /^what\s/i,
    /^when\s/i,
    /^where\s/i,
    /^how\s/i,
    /^why\s/i,
    /^which\s/i,
    /^who\s/i,
    /^show\s+me/i,
    /^find\s/i,
    /^search\s/i,
    /^list\s/i,
    /^tell\s+me\s+about/i,
    /^what\s+did\s+i/i,
    /^have\s+i/i,
    /^do\s+i\s+have/i,
    /\?$/,
  ];
  
  return queryPatterns.some(pattern => pattern.test(message.trim()));
}


/**
 * Project query result structure
 * 
 * Validates: Requirements 6.4
 */
export interface ProjectQueryResult {
  projects: Array<{
    sbId: string;
    title: string;
    status: ProjectStatus;
    path: string;
  }>;
  totalCount: number;
}

/**
 * Task log entry structure
 */
export interface TaskLogEntry {
  date: string;
  title: string;
}

/**
 * Extract project info from a knowledge file
 */
function extractProjectInfo(file: KnowledgeFile): {
  sbId: string;
  title: string;
  status: ProjectStatus;
  path: string;
} | null {
  try {
    const parsed = parseFrontMatter(file.content);
    const fm = parsed.frontMatter;
    
    // Validate required fields
    if (!fm.id || typeof fm.id !== 'string' || !fm.id.match(/^sb-[a-f0-9]{7}$/)) {
      return null;
    }
    if (!fm.title || typeof fm.title !== 'string') {
      return null;
    }
    if (fm.type !== 'project') {
      return null;
    }
    
    // Default status to 'active' if not present
    const status = (fm.status as ProjectStatus) || 'active';
    
    return {
      sbId: fm.id as string,
      title: fm.title as string,
      status,
      path: file.path,
    };
  } catch {
    return null;
  }
}

/**
 * Query projects by status
 * 
 * Searches the 30-projects/ folder, parses front matter to extract status,
 * and filters by the requested status.
 * 
 * Validates: Requirements 6.1, 6.2, 6.4
 */
export function queryProjectsByStatus(
  files: KnowledgeFile[],
  status: ProjectStatus
): ProjectQueryResult {
  // Filter to only project files
  const projectFiles = files.filter(f => f.path.startsWith('30-projects/'));
  
  const matchingProjects: ProjectQueryResult['projects'] = [];
  
  for (const file of projectFiles) {
    const projectInfo = extractProjectInfo(file);
    if (projectInfo && projectInfo.status === status) {
      matchingProjects.push(projectInfo);
    }
  }
  
  return {
    projects: matchingProjects,
    totalCount: matchingProjects.length,
  };
}

/**
 * Get all projects with their status
 * 
 * Returns all projects regardless of status.
 */
export function getAllProjects(files: KnowledgeFile[]): ProjectQueryResult {
  const projectFiles = files.filter(f => f.path.startsWith('30-projects/'));
  
  const projects: ProjectQueryResult['projects'] = [];
  
  for (const file of projectFiles) {
    const projectInfo = extractProjectInfo(file);
    if (projectInfo) {
      projects.push(projectInfo);
    }
  }
  
  return {
    projects,
    totalCount: projects.length,
  };
}

/**
 * Parse task log entries from project content
 * 
 * Extracts entries from the ## Tasks section.
 * 
 * Validates: Requirements 6.3
 */
export function parseTaskLogEntries(content: string): TaskLogEntry[] {
  const entries: TaskLogEntry[] = [];
  
  // Find the ## Tasks section header
  const startMatch = content.match(/^## Tasks\s*\n/m);
  if (!startMatch || startMatch.index === undefined) {
    return entries;
  }
  
  // Get content after the header
  const startIdx = startMatch.index + startMatch[0].length;
  const afterTasks = content.slice(startIdx);
  
  // Find where the section ends (next ## header or --- separator)
  const endMatch = afterTasks.match(/\n(?=## |---\n)/);
  const tasksSection = endMatch ? afterTasks.slice(0, endMatch.index) : afterTasks;
  
  // Parse each line that matches the task entry format: - YYYY-MM-DD: title
  const lines = tasksSection.split('\n');
  for (const line of lines) {
    const match = line.match(/^- (\d{4}-\d{2}-\d{2}): (.+)$/);
    if (match) {
      entries.push({
        date: match[1],
        title: match[2].trim(),
      });
    }
  }
  
  return entries;
}

/**
 * Get task log from a project file
 * 
 * Reads the project file and parses the ## Tasks section.
 * 
 * Validates: Requirements 6.3
 */
export function getProjectTaskLog(
  files: KnowledgeFile[],
  projectPath: string
): TaskLogEntry[] {
  const file = files.find(f => f.path === projectPath);
  if (!file) {
    return [];
  }
  
  return parseTaskLogEntries(file.content);
}

/**
 * Format project query results for Slack
 */
export function formatProjectQueryForSlack(
  result: ProjectQueryResult,
  status?: ProjectStatus
): string {
  if (result.totalCount === 0) {
    if (status) {
      return `No ${status} projects found.`;
    }
    return 'No projects found.';
  }
  
  const statusLabel = status ? `${status} ` : '';
  const header = `Found ${result.totalCount} ${statusLabel}project${result.totalCount === 1 ? '' : 's'}:\n`;
  
  const projectList = result.projects
    .map(p => `• *${p.title}* (\`${p.sbId}\`) - ${p.status}`)
    .join('\n');
  
  return header + projectList;
}

/**
 * Format task log for Slack
 */
export function formatTaskLogForSlack(
  entries: TaskLogEntry[],
  projectTitle: string
): string {
  if (entries.length === 0) {
    return `No tasks logged for ${projectTitle}.`;
  }
  
  const header = `Tasks for *${projectTitle}* (${entries.length} total):\n`;
  
  const taskList = entries
    .map(e => `• ${e.date}: ${e.title}`)
    .join('\n');
  
  return header + taskList;
}
