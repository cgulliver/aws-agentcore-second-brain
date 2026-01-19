/**
 * Knowledge Search Component
 * 
 * Provides semantic search capabilities over the CodeCommit knowledge repository.
 * 
 * Validates: Requirements 54 (Semantic Query Processing)
 */

import {
  CodeCommitClient,
  GetFolderCommand,
  GetFileCommand,
} from '@aws-sdk/client-codecommit';

/**
 * Configuration for knowledge search
 */
export interface KnowledgeSearchConfig {
  repositoryName: string;
  branchName: string;
  maxFilesToSearch: number;
  maxExcerptLength: number;
}

/**
 * Default search configuration
 */
export const DEFAULT_SEARCH_CONFIG: Partial<KnowledgeSearchConfig> = {
  branchName: 'main',
  maxFilesToSearch: 50,
  maxExcerptLength: 500,
};

/**
 * Parsed front matter from a markdown file
 * Validates: Requirements 6.3, 6.4
 */
export interface ParsedFrontMatter {
  id?: string;
  type?: string;
  title?: string;
  created_at?: string;
  tags?: string[];
}

/**
 * A file with its content from the knowledge repository
 */
export interface KnowledgeFile {
  path: string;
  content: string;
  folder: string;
  date?: string;
}

/**
 * A file with parsed front matter metadata
 * Validates: Requirements 6.3
 */
export interface KnowledgeFileWithMeta extends KnowledgeFile {
  frontMatter?: ParsedFrontMatter;
  sbId?: string;
}

/**
 * A cited file with relevance information
 */
export interface CitedFile {
  path: string;
  relevanceScore: number;
  excerpt: string;
  date?: string;
}

/**
 * Search result from the knowledge repository
 */
export interface KnowledgeSearchResult {
  files: KnowledgeFileWithMeta[];
  totalFilesSearched: number;
  searchedFolders: string[];
}

/**
 * Folders to search for knowledge (excludes receipts)
 * Validates: Requirement 54.2, 54.3
 */
const SEARCHABLE_FOLDERS = [
  '00-inbox',
  '10-ideas',
  '20-decisions',
  '30-projects',
];

/**
 * Extract date from file path or content
 */
export function extractDateFromPath(path: string): string | undefined {
  // Match YYYY-MM-DD pattern in path
  const dateMatch = path.match(/(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : undefined;
}

/**
 * Parse YAML front matter from markdown content
 * Returns null if no front matter found or if malformed
 * 
 * Validates: Requirements 6.3, 6.4
 */
export function parseFrontMatter(content: string): ParsedFrontMatter | null {
  // Front matter must start at position 0 with ---
  if (!content.startsWith('---\n')) {
    return null;
  }
  
  // Find the closing ---
  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return null;
  }
  
  const yamlBlock = content.slice(4, endIndex);
  const result: ParsedFrontMatter = {};
  
  try {
    // Simple YAML parsing for our known fields
    const lines = yamlBlock.split('\n');
    let inTags = false;
    const tags: string[] = [];
    
    for (const line of lines) {
      if (inTags) {
        // Check if this is a tag list item
        const tagMatch = line.match(/^\s+-\s+(.+)$/);
        if (tagMatch) {
          tags.push(tagMatch[1].trim());
          continue;
        } else {
          // End of tags array
          inTags = false;
        }
      }
      
      // Parse key: value pairs
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        
        if (key === 'id') {
          result.id = value.trim();
        } else if (key === 'type') {
          result.type = value.trim();
        } else if (key === 'title') {
          // Handle quoted titles
          const titleMatch = value.match(/^"(.+)"$/) || value.match(/^'(.+)'$/);
          result.title = titleMatch ? titleMatch[1].replace(/\\"/g, '"') : value.trim();
        } else if (key === 'created_at') {
          result.created_at = value.trim();
        } else if (key === 'tags') {
          if (value.trim() === '[]') {
            // Empty array
            result.tags = [];
          } else if (value.trim() === '') {
            // Tags on following lines
            inTags = true;
          }
        }
      }
    }
    
    if (tags.length > 0) {
      result.tags = tags;
    }
    
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    // Malformed YAML - return null gracefully
    return null;
  }
}

/**
 * Extract a relevant excerpt from content based on query keywords
 */
export function extractExcerpt(
  content: string,
  query: string,
  maxLength: number
): string {
  // Get keywords from query (words > 3 chars, excluding common words)
  const stopWords = new Set(['what', 'when', 'where', 'which', 'have', 'about', 'from', 'that', 'this', 'with', 'your', 'show']);
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  
  if (keywords.length === 0) {
    // No meaningful keywords, return start of content
    return content.slice(0, maxLength).trim() + (content.length > maxLength ? '...' : '');
  }
  
  // Find the best paragraph containing keywords
  const paragraphs = content.split(/\n\n+/);
  let bestParagraph = paragraphs[0] || '';
  let bestScore = 0;
  
  for (const para of paragraphs) {
    const paraLower = para.toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
      if (paraLower.includes(keyword)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestParagraph = para;
    }
  }
  
  // Truncate if needed
  if (bestParagraph.length > maxLength) {
    return bestParagraph.slice(0, maxLength).trim() + '...';
  }
  
  return bestParagraph.trim();
}

/**
 * List all markdown files in a folder
 */
async function listFolderFiles(
  client: CodeCommitClient,
  repositoryName: string,
  folderPath: string,
  commitSpecifier: string
): Promise<string[]> {
  try {
    const response = await client.send(
      new GetFolderCommand({
        repositoryName,
        folderPath,
        commitSpecifier,
      })
    );
    
    const files: string[] = [];
    
    // Add files from this folder
    if (response.files) {
      for (const file of response.files) {
        if (file.absolutePath?.endsWith('.md')) {
          files.push(file.absolutePath);
        }
      }
    }
    
    return files;
  } catch (error) {
    // Folder might not exist yet
    if ((error as Error).name === 'FolderDoesNotExistException') {
      return [];
    }
    throw error;
  }
}

/**
 * Read file content from CodeCommit
 */
async function readFileContent(
  client: CodeCommitClient,
  repositoryName: string,
  filePath: string,
  commitSpecifier: string
): Promise<string | null> {
  try {
    const response = await client.send(
      new GetFileCommand({
        repositoryName,
        filePath,
        commitSpecifier,
      })
    );
    
    if (response.fileContent) {
      return Buffer.from(response.fileContent).toString('utf-8');
    }
    return null;
  } catch (error) {
    if ((error as Error).name === 'FileDoesNotExistException') {
      return null;
    }
    throw error;
  }
}

/**
 * Search the knowledge repository for files
 * 
 * Validates: Requirements 54.1, 54.2, 54.3, 6.3
 */
export async function searchKnowledgeBase(
  client: CodeCommitClient,
  config: KnowledgeSearchConfig
): Promise<KnowledgeSearchResult> {
  const files: KnowledgeFileWithMeta[] = [];
  const searchedFolders: string[] = [];
  
  for (const folder of SEARCHABLE_FOLDERS) {
    searchedFolders.push(folder);
    
    const filePaths = await listFolderFiles(
      client,
      config.repositoryName,
      folder,
      config.branchName
    );
    
    for (const filePath of filePaths) {
      if (files.length >= config.maxFilesToSearch) {
        break;
      }
      
      const content = await readFileContent(
        client,
        config.repositoryName,
        filePath,
        config.branchName
      );
      
      if (content) {
        // Parse front matter if present
        const frontMatter = parseFrontMatter(content);
        
        files.push({
          path: filePath,
          content,
          folder,
          date: extractDateFromPath(filePath),
          frontMatter: frontMatter ?? undefined,
          sbId: frontMatter?.id,
        });
      }
    }
    
    if (files.length >= config.maxFilesToSearch) {
      break;
    }
  }
  
  return {
    files,
    totalFilesSearched: files.length,
    searchedFolders,
  };
}

/**
 * Format knowledge files as context for the LLM
 */
export function formatFilesAsContext(files: KnowledgeFile[] | KnowledgeFileWithMeta[]): string {
  if (files.length === 0) {
    return 'No knowledge files found in the repository.';
  }
  
  const sections: string[] = [];
  
  for (const file of files) {
    const dateInfo = file.date ? ` (${file.date})` : '';
    const sbIdInfo = 'sbId' in file && file.sbId ? ` [${file.sbId}]` : '';
    sections.push(`--- FILE: ${file.path}${dateInfo}${sbIdInfo} ---\n${file.content}\n`);
  }
  
  return sections.join('\n');
}

/**
 * Simple keyword-based relevance scoring
 * Returns files sorted by relevance to the query
 * 
 * Validates: Requirement 54.4, 6.1, 6.2
 */
export function scoreFileRelevance(
  files: KnowledgeFile[] | KnowledgeFileWithMeta[],
  query: string,
  maxExcerptLength: number
): CitedFile[] {
  const queryLower = query.toLowerCase();
  
  // Get keywords, handling common stop words
  const stopWords = new Set(['what', 'when', 'where', 'which', 'have', 'has', 'had', 'about', 'from', 'that', 'this', 'with', 'your', 'show', 'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out']);
  const keywords = queryLower
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  // Create stemmed versions of keywords (simple stemming - remove common suffixes)
  const stemmedKeywords = keywords.map(k => {
    // Remove common plural/verb suffixes
    if (k.endsWith('ies')) return k.slice(0, -3) + 'y';
    if (k.endsWith('es')) return k.slice(0, -2);
    if (k.endsWith('s') && !k.endsWith('ss')) return k.slice(0, -1);
    if (k.endsWith('ed')) return k.slice(0, -2);
    if (k.endsWith('ing')) return k.slice(0, -3);
    return k;
  });
  
  const scored: CitedFile[] = files.map(file => {
    const contentLower = file.content.toLowerCase();
    const pathLower = file.path.toLowerCase();
    
    let score = 0;
    
    // Score based on keyword matches (both original and stemmed)
    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      const stemmed = stemmedKeywords[i];
      
      // Title/path matches are worth more
      if (pathLower.includes(keyword) || pathLower.includes(stemmed)) {
        score += 3;
      }
      
      // Content matches (check both original and stemmed)
      const keywordMatches = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
      const stemmedMatches = keyword !== stemmed 
        ? (contentLower.match(new RegExp(stemmed, 'g')) || []).length 
        : 0;
      score += Math.min(keywordMatches + stemmedMatches, 5); // Cap at 5 matches per keyword
    }
    
    // Folder-based relevance boost
    // If query mentions "decisions" and file is in 20-decisions/, boost score
    if (queryLower.includes('decision') && pathLower.includes('20-decisions/')) {
      score += 5;
    }
    if (queryLower.includes('idea') && pathLower.includes('10-ideas/')) {
      score += 5;
    }
    if (queryLower.includes('project') && pathLower.includes('30-projects/')) {
      score += 5;
    }
    if (queryLower.includes('inbox') && pathLower.includes('00-inbox/')) {
      score += 5;
    }
    
    // Tag-based relevance boost (Validates: Requirements 6.1, 6.2)
    // +4 points per exact tag match with query keywords
    if ('frontMatter' in file && file.frontMatter?.tags) {
      for (const tag of file.frontMatter.tags) {
        const tagLower = tag.toLowerCase();
        // Check if any keyword matches the tag (exact or partial)
        for (let i = 0; i < keywords.length; i++) {
          const keyword = keywords[i];
          const stemmed = stemmedKeywords[i];
          if (tagLower === keyword || tagLower === stemmed || 
              tagLower.includes(keyword) || tagLower.includes(stemmed)) {
            score += 4;
            break; // Only count each tag once
          }
        }
      }
    }
    
    // Normalize score to 0-1 range (adjusted for folder boost and tag boost)
    const normalizedScore = Math.min(score / (keywords.length * 12 + 5), 1);
    
    return {
      path: file.path,
      relevanceScore: normalizedScore,
      excerpt: extractExcerpt(file.content, query, maxExcerptLength),
      date: file.date,
    };
  });
  
  // Sort by relevance score descending
  return scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Get top relevant files for a query
 */
export function getTopRelevantFiles(
  files: KnowledgeFile[] | KnowledgeFileWithMeta[],
  query: string,
  topK: number,
  maxExcerptLength: number
): CitedFile[] {
  const scored = scoreFileRelevance(files, query, maxExcerptLength);
  return scored.slice(0, topK).filter(f => f.relevanceScore > 0);
}
