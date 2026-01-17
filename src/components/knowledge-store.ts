/**
 * Knowledge Store Component
 * 
 * Provides CodeCommit file operations for the knowledge repository.
 * Implements append-only patterns and commit retry logic.
 * 
 * Validates: Requirements 11-13, 29, 30
 */

import {
  CodeCommitClient,
  GetBranchCommand,
  GetFileCommand,
  CreateCommitCommand,
  FileDoesNotExistException,
  BranchDoesNotExistException,
  ParentCommitIdOutdatedException,
} from '@aws-sdk/client-codecommit';
import type { Classification } from '../types';

// Configuration
export interface KnowledgeStoreConfig {
  repositoryName: string;
  branchName: string;
}

// Commit result
export interface CommitResult {
  commitId: string;
  filePath: string;
  parentCommitId: string | null;
}

// File content for write operations
export interface FileContent {
  path: string;
  content: string;
  mode: 'create' | 'append' | 'update';
}

// Default configuration
const DEFAULT_BRANCH = 'main';
const MAX_RETRIES = 3;

// CodeCommit client
const codecommitClient = new CodeCommitClient({});

/**
 * Get the latest commit ID for the branch
 * 
 * Validates: Requirements 11, 12
 */
export async function getLatestCommitId(
  config: KnowledgeStoreConfig
): Promise<string | null> {
  try {
    const response = await codecommitClient.send(
      new GetBranchCommand({
        repositoryName: config.repositoryName,
        branchName: config.branchName || DEFAULT_BRANCH,
      })
    );
    return response.branch?.commitId || null;
  } catch (error) {
    if (error instanceof BranchDoesNotExistException) {
      return null;
    }
    throw error;
  }
}

/**
 * Read file content from repository
 * 
 * Validates: Requirements 11, 12
 */
export async function readFile(
  config: KnowledgeStoreConfig,
  filePath: string
): Promise<string | null> {
  try {
    const response = await codecommitClient.send(
      new GetFileCommand({
        repositoryName: config.repositoryName,
        filePath,
      })
    );
    
    if (!response.fileContent) {
      return null;
    }
    
    // fileContent is a Uint8Array
    return Buffer.from(response.fileContent).toString('utf-8');
  } catch (error) {
    if (error instanceof FileDoesNotExistException) {
      return null;
    }
    throw error;
  }
}

/**
 * Write file to repository with retry logic
 * 
 * Validates: Requirements 11, 12, 12.1-12.3
 */
export async function writeFile(
  config: KnowledgeStoreConfig,
  file: FileContent,
  commitMessage: string,
  parentCommitId: string | null
): Promise<CommitResult> {
  let attempts = 0;
  let currentParentId = parentCommitId;

  while (attempts < MAX_RETRIES) {
    try {
      const response = await codecommitClient.send(
        new CreateCommitCommand({
          repositoryName: config.repositoryName,
          branchName: config.branchName || DEFAULT_BRANCH,
          parentCommitId: currentParentId || undefined,
          authorName: 'Second Brain Agent',
          email: 'agent@second-brain.local',
          commitMessage,
          putFiles: [
            {
              filePath: file.path,
              fileContent: Buffer.from(file.content),
            },
          ],
        })
      );

      return {
        commitId: response.commitId || '',
        filePath: file.path,
        parentCommitId: currentParentId,
      };
    } catch (error) {
      if (error instanceof ParentCommitIdOutdatedException) {
        // Retry with updated parent commit
        attempts++;
        if (attempts < MAX_RETRIES) {
          currentParentId = await getLatestCommitId(config);
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error(`Failed to write file after ${MAX_RETRIES} retries`);
}

/**
 * Append content to existing file (or create if doesn't exist)
 * 
 * Validates: Requirements 13.1, 13.2, 13.3
 */
export async function appendToFile(
  config: KnowledgeStoreConfig,
  filePath: string,
  content: string,
  commitMessage: string
): Promise<CommitResult> {
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    try {
      // Get current content and parent commit
      const parentCommitId = await getLatestCommitId(config);
      const existingContent = await readFile(config, filePath);

      // Append new content
      const newContent = existingContent
        ? `${existingContent}\n${content}`
        : content;

      return await writeFile(
        config,
        { path: filePath, content: newContent, mode: 'append' },
        commitMessage,
        parentCommitId
      );
    } catch (error) {
      if (error instanceof ParentCommitIdOutdatedException) {
        attempts++;
        if (attempts < MAX_RETRIES) {
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error(`Failed to append to file after ${MAX_RETRIES} retries`);
}

/**
 * Generate file path based on classification
 * 
 * Validates: Requirements 11.1-11.4, 29.3
 */
export function generateFilePath(
  classification: Classification,
  slug?: string,
  date?: Date
): string {
  const d = date || new Date();
  const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD

  switch (classification) {
    case 'inbox':
      return `00-inbox/${dateStr}.md`;
    case 'idea':
      if (!slug) throw new Error('Slug required for idea classification');
      return `10-ideas/${slug}.md`;
    case 'decision':
      if (!slug) throw new Error('Slug required for decision classification');
      return `20-decisions/${dateStr}-${slug}.md`;
    case 'project':
      if (!slug) throw new Error('Slug required for project classification');
      return `30-projects/${slug}.md`;
    case 'task':
      // Tasks don't create files, they send emails
      return `00-inbox/${dateStr}.md`;
    default:
      return `00-inbox/${dateStr}.md`;
  }
}

/**
 * Generate slug from text
 * 
 * Validates: Requirements 30.1-30.4
 * - Lowercase
 * - Hyphen-separated
 * - 3-8 words
 * - ASCII only
 * - No dates in idea slugs
 */
export function generateSlug(text: string): string {
  // Remove non-ASCII characters
  const ascii = text.replace(/[^\x00-\x7F]/g, '');

  // Convert to lowercase and split into words
  const words = ascii
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);

  // Remove date-like patterns (YYYY, MM-DD, etc.)
  const filteredWords = words.filter(
    (word) => !/^\d{4}$/.test(word) && !/^\d{1,2}$/.test(word)
  );

  // Take 3-8 words
  const slugWords = filteredWords.slice(0, 8);
  
  // Ensure at least 3 words (pad with generic words if needed)
  while (slugWords.length < 3 && slugWords.length > 0) {
    slugWords.push('note');
  }

  // If no words, use fallback
  if (slugWords.length === 0) {
    return 'untitled-note';
  }

  return slugWords.join('-');
}

/**
 * Create or update a knowledge file
 */
export async function createKnowledgeFile(
  config: KnowledgeStoreConfig,
  classification: Classification,
  content: string,
  title: string,
  slug?: string
): Promise<CommitResult> {
  const filePath = generateFilePath(classification, slug || generateSlug(title));
  const commitMessage = `Add ${classification}: ${title}`;

  if (classification === 'inbox') {
    // Inbox uses append-only pattern
    return appendToFile(config, filePath, content, commitMessage);
  }

  // Other classifications create new files
  const parentCommitId = await getLatestCommitId(config);
  return writeFile(
    config,
    { path: filePath, content, mode: 'create' },
    commitMessage,
    parentCommitId
  );
}
