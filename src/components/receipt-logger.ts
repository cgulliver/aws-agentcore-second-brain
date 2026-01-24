/**
 * Receipt Logger Component
 * 
 * Creates and manages receipts for all agent actions.
 * Receipts are stored as JSON Lines in CodeCommit.
 * 
 * Validates: Requirements 10.2, 15, 16, 19.2, 36, 45
 */

import type { Classification } from '../types';
import {
  appendToFile,
  readFile,
  type KnowledgeStoreConfig,
  type CommitResult,
} from './knowledge-store';

// Receipt action types
export interface ReceiptAction {
  type: 'commit' | 'email' | 'slack_reply' | 'health_check';
  status: 'success' | 'failed' | 'failure' | 'skipped';
  details: Record<string, unknown>;
}

// Slack context for receipt
export interface SlackContext {
  user_id: string;
  channel_id: string;
  message_ts: string;
  thread_ts?: string;
}

// Full receipt structure
export interface Receipt {
  timestamp_iso: string;
  event_id: string;
  slack: SlackContext;
  classification: Classification | 'fix' | 'clarify' | 'query' | 'status_update';
  confidence: number;
  actions: ReceiptAction[];
  files: string[];
  commit_id: string | null;
  prior_commit_id: string | null;
  summary: string;
  prompt_commit_id?: string;
  prompt_sha256?: string;
  validation_errors?: string[];
  // Status update metadata
  project_sb_id?: string;
  previous_status?: string;
  new_status?: string;
}

// Receipt file path
const RECEIPTS_FILE = '90-receipts/receipts.jsonl';

/**
 * Create a receipt with all required fields
 * 
 * Validates: Requirements 15, 16, 36, 45, 56 (Phase 2 Query)
 */
export function createReceipt(
  eventId: string,
  slackContext: SlackContext,
  classification: Classification | 'fix' | 'clarify' | 'query' | 'status_update',
  confidence: number,
  actions: ReceiptAction[],
  files: string[],
  commitId: string | null,
  summary: string,
  options?: {
    priorCommitId?: string | null;
    promptCommitId?: string;
    promptSha256?: string;
    validationErrors?: string[];
    queryHash?: string;
    filesSearched?: number;
    filesCited?: number;
    // Status update metadata
    projectSbId?: string;
    previousStatus?: string;
    newStatus?: string;
    // Query metadata
    queryStatus?: string;
    projectsFound?: number;
    // Health check metadata
    healthReport?: Record<string, unknown>;
    // Multi-item metadata
    multi_item?: Record<string, unknown>;
  }
): Receipt {
  return {
    timestamp_iso: new Date().toISOString(),
    event_id: eventId,
    slack: slackContext,
    classification,
    confidence,
    actions,
    files,
    commit_id: commitId,
    prior_commit_id: options?.priorCommitId || null,
    summary,
    prompt_commit_id: options?.promptCommitId,
    prompt_sha256: options?.promptSha256,
    validation_errors: options?.validationErrors,
    project_sb_id: options?.projectSbId,
    previous_status: options?.previousStatus,
    new_status: options?.newStatus,
  };
}

/**
 * Serialize receipt to JSON string (single line)
 * 
 * Validates: Requirements 15.2, 36
 */
export function serializeReceipt(receipt: Receipt): string {
  return JSON.stringify(receipt);
}

/**
 * Parse receipt from JSON string
 * 
 * Validates: Requirements 15.2, 36
 */
export function parseReceipt(line: string): Receipt {
  return JSON.parse(line) as Receipt;
}

/**
 * Append receipt to receipts file
 * 
 * Validates: Requirements 15.1, 15.3
 */
export async function appendReceipt(
  config: KnowledgeStoreConfig,
  receipt: Receipt
): Promise<CommitResult> {
  const receiptLine = serializeReceipt(receipt);
  const commitMessage = `Receipt: ${receipt.classification} - ${receipt.event_id}`;

  return appendToFile(config, RECEIPTS_FILE, receiptLine, commitMessage);
}

/**
 * Find receipt by event ID
 * 
 * Validates: Requirements 10.2, 19.2
 */
export async function findReceiptByEventId(
  config: KnowledgeStoreConfig,
  eventId: string
): Promise<Receipt | null> {
  const content = await readFile(config, RECEIPTS_FILE);

  if (!content) {
    return null;
  }

  const lines = content.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    try {
      const receipt = parseReceipt(line);
      if (receipt.event_id === eventId) {
        return receipt;
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return null;
}

/**
 * Find most recent receipt for a user
 * 
 * Validates: Requirements 10.2
 * 
 * @param excludeNonFixable - If true, excludes receipts that cannot be fixed:
 *   - fix: Cannot fix a fix entry
 *   - clarify: Cannot fix a clarification
 *   - task: Tasks are sent to OmniFocus, not stored in CodeCommit
 *   - query: Queries don't create files to fix
 *   - status_update: Status updates modify existing files differently
 */
export async function findMostRecentReceipt(
  config: KnowledgeStoreConfig,
  userId: string,
  excludeNonFixable: boolean = true
): Promise<Receipt | null> {
  const content = await readFile(config, RECEIPTS_FILE);

  if (!content) {
    return null;
  }

  const lines = content.split('\n').filter((line) => line.trim());
  let mostRecent: Receipt | null = null;
  let mostRecentTime = 0;

  // Classifications that cannot be fixed
  const nonFixableTypes = ['fix', 'clarify', 'task', 'query', 'status_update'];

  for (const line of lines) {
    try {
      const receipt = parseReceipt(line);
      
      // Filter by user
      if (receipt.slack.user_id !== userId) {
        continue;
      }

      // Optionally exclude non-fixable receipts
      if (excludeNonFixable && nonFixableTypes.includes(receipt.classification)) {
        continue;
      }

      // Check if more recent
      const receiptTime = new Date(receipt.timestamp_iso).getTime();
      if (receiptTime > mostRecentTime) {
        mostRecent = receipt;
        mostRecentTime = receiptTime;
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return mostRecent;
}

/**
 * Get all receipts (for debugging/admin)
 */
export async function getAllReceipts(
  config: KnowledgeStoreConfig
): Promise<Receipt[]> {
  const content = await readFile(config, RECEIPTS_FILE);

  if (!content) {
    return [];
  }

  const lines = content.split('\n').filter((line) => line.trim());
  const receipts: Receipt[] = [];

  for (const line of lines) {
    try {
      receipts.push(parseReceipt(line));
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return receipts;
}
