/**
 * Project Matcher Component
 * 
 * Searches for projects matching a natural language reference.
 * Used for task-project linking when users mention projects in task messages.
 * 
 * Validates: Requirements 2.1-2.5, 3.1, 4.1-4.2
 */

import { CodeCommitClient, GetFolderCommand, GetFileCommand } from '@aws-sdk/client-codecommit';

// Project match result
export interface ProjectMatch {
  sbId: string;
  title: string;
  path: string;
  confidence: number;
}

// Result of project matching operation
export interface ProjectMatchResult {
  bestMatch: ProjectMatch | null;
  candidates: ProjectMatch[];
  searchedCount: number;
}

// Configuration for project matcher
export interface ProjectMatcherConfig {
  repositoryName: string;
  branchName: string;
  minConfidence: number;      // 0.5 - minimum to be a candidate
  autoLinkConfidence: number; // 0.7 - auto-link threshold
  maxCandidates: number;      // 3 - max candidates to return
}

// Default configuration
export const DEFAULT_PROJECT_MATCHER_CONFIG: Partial<ProjectMatcherConfig> = {
  branchName: 'main',
  minConfidence: 0.5,
  autoLinkConfidence: 0.7,
  maxCandidates: 3,
};

// Project metadata extracted from front matter
interface ProjectMetadata {
  sbId: string;
  title: string;
  tags: string[];
  content: string;
  path: string;
}

/**
 * Parse YAML front matter from markdown content
 */
function parseFrontMatter(content: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  
  if (!content.startsWith('---\n')) {
    return result;
  }
  
  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return result;
  }
  
  const yamlBlock = content.substring(4, endIndex);
  const lines = yamlBlock.split('\n');
  
  let currentKey = '';
  let inArray = false;
  const arrayValues: string[] = [];
  
  for (const line of lines) {
    // Check for array item
    if (inArray && line.match(/^\s+-\s+/)) {
      const value = line.replace(/^\s+-\s+/, '').trim();
      arrayValues.push(value);
      continue;
    }
    
    // If we were in an array, save it
    if (inArray && currentKey) {
      result[currentKey] = [...arrayValues];
      inArray = false;
      arrayValues.length = 0;
    }
    
    // Check for key: value
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      currentKey = match[1];
      const value = match[2].trim();
      
      if (value === '' || value === '[]') {
        // Might be start of array
        inArray = true;
      } else {
        result[currentKey] = value.replace(/^["']|["']$/g, '');
      }
    }
  }
  
  // Handle trailing array
  if (inArray && currentKey) {
    result[currentKey] = [...arrayValues];
  }
  
  return result;
}

/**
 * Extract project metadata from file content
 */
function extractProjectMetadata(content: string, path: string): ProjectMetadata | null {
  const frontMatter = parseFrontMatter(content);
  
  const sbId = frontMatter.id as string;
  const title = frontMatter.title as string;
  
  if (!sbId || !title) {
    return null;
  }
  
  // Validate SB_ID format
  if (!/^sb-[a-f0-9]{7}$/.test(sbId)) {
    return null;
  }
  
  const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : [];
  
  // Get content after front matter
  const contentStart = content.indexOf('\n---\n', 4);
  const bodyContent = contentStart !== -1 ? content.substring(contentStart + 5) : '';
  
  return {
    sbId,
    title,
    tags,
    content: bodyContent,
    path,
  };
}

/**
 * Calculate similarity between two strings (case-insensitive)
 * Uses a simple word overlap approach
 */
function calculateSimilarity(str1: string, str2: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const words1 = new Set(normalize(str1).split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(normalize(str2).split(/\s+/).filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }
  
  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      matches++;
    }
  }
  
  // Jaccard-like similarity
  const union = new Set([...words1, ...words2]).size;
  return matches / union;
}

/**
 * Check if reference contains any of the words from target
 */
function containsWords(reference: string, target: string): boolean {
  const refLower = reference.toLowerCase();
  const targetWords = target.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return targetWords.some(word => refLower.includes(word));
}

/**
 * Score how well a project matches a reference
 * 
 * Validates: Requirements 2.3, 2.4
 * 
 * Scoring weights:
 * - Title match: 0.6 (highest weight)
 * - Tag match: 0.25
 * - Content match: 0.15
 */
export function scoreProjectMatch(project: ProjectMetadata, reference: string): number {
  const refLower = reference.toLowerCase();
  const titleLower = project.title.toLowerCase();
  
  let score = 0;
  
  // Title similarity (highest weight: 0.6)
  const titleSimilarity = calculateSimilarity(reference, project.title);
  
  // Bonus for exact substring match in title
  const titleContainsRef = titleLower.includes(refLower) || containsWords(reference, project.title);
  const titleBonus = titleContainsRef ? 0.3 : 0;
  
  score += Math.min(0.6, (titleSimilarity * 0.6) + titleBonus);
  
  // Tag matches (weight: 0.25)
  const tagMatches = project.tags.filter(tag => {
    const tagLower = tag.toLowerCase();
    return refLower.includes(tagLower) || tagLower.includes(refLower) || 
           calculateSimilarity(reference, tag) > 0.5;
  });
  const tagScore = Math.min(0.25, (tagMatches.length / Math.max(1, project.tags.length)) * 0.25);
  score += tagScore;
  
  // Content relevance (weight: 0.15)
  const contentSimilarity = calculateSimilarity(reference, project.content.substring(0, 500));
  score += contentSimilarity * 0.15;
  
  return Math.min(1, score);
}

/**
 * Find projects matching a natural language reference
 * 
 * Validates: Requirements 2.1, 2.2, 2.5
 */
export async function findMatchingProject(
  config: ProjectMatcherConfig,
  projectReference: string,
  client?: CodeCommitClient
): Promise<ProjectMatchResult> {
  const codecommit = client || new CodeCommitClient({});
  
  const result: ProjectMatchResult = {
    bestMatch: null,
    candidates: [],
    searchedCount: 0,
  };
  
  try {
    // Get list of files in 30-projects/ folder
    const folderResponse = await codecommit.send(new GetFolderCommand({
      repositoryName: config.repositoryName,
      commitSpecifier: config.branchName,
      folderPath: '30-projects',
    }));
    
    const files = folderResponse.files || [];
    const projectFiles = files.filter(f => f.absolutePath?.endsWith('.md'));
    
    const matches: ProjectMatch[] = [];
    
    // Score each project
    for (const file of projectFiles) {
      if (!file.absolutePath) continue;
      
      try {
        const fileResponse = await codecommit.send(new GetFileCommand({
          repositoryName: config.repositoryName,
          commitSpecifier: config.branchName,
          filePath: file.absolutePath,
        }));
        
        if (!fileResponse.fileContent) continue;
        
        const content = Buffer.from(fileResponse.fileContent).toString('utf-8');
        const metadata = extractProjectMetadata(content, file.absolutePath);
        
        if (!metadata) continue;
        
        result.searchedCount++;
        
        const confidence = scoreProjectMatch(metadata, projectReference);
        
        if (confidence >= config.minConfidence) {
          matches.push({
            sbId: metadata.sbId,
            title: metadata.title,
            path: metadata.path,
            confidence,
          });
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }
    
    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence);
    
    // Set best match if above auto-link threshold
    if (matches.length > 0 && matches[0].confidence >= config.autoLinkConfidence) {
      result.bestMatch = matches[0];
    }
    
    // Set candidates (up to maxCandidates)
    result.candidates = matches.slice(0, config.maxCandidates);
    
  } catch (error) {
    // Log error but return empty result (graceful degradation)
    console.error('Project matching failed:', error);
  }
  
  return result;
}
