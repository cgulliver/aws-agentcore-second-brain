/**
 * Query Handler Component
 * 
 * Handles semantic query processing and response generation.
 * 
 * Validates: Requirements 55 (Query Response Generation)
 */

import type { CitedFile, KnowledgeFile } from './knowledge-search';
import { getTopRelevantFiles, formatFilesAsContext } from './knowledge-search';

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
