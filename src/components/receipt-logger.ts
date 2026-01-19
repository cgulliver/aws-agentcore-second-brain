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
  type: 'commit' | 'email' | 'slack_reply';
  status: 'success' | 'failed' | 'skipped';
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
  classification: Classification | 'fix' | 'clarify' | 'query';
  confidence: number;
  actions: ReceiptAction[];
  files: string[];
  commit_id: string | null;
  prior_commit_id: string | null;
  summary: string;
  prompt_commit_id?: string;
  prompt_sha256?: string;
  validation_errors?: string[];
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
  classification: Classification | 'fix' | 'clarify' | 'query',
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
 */
export async function findMostRecentReceipt(
  config: KnowledgeStoreConfig,
  userId: string,
  excludeFix: boolean = true
): Promise<Receipt | null> {
  const content = await readFile(config, RECEIPTS_FILE);

  if (!content) {
    return null;
  }

  const lines = content.split('\n').filter((line) => line.trim());
  let mostRecent: Receipt | null = null;
  let mostRecentTime = 0;

  for (const line of lines) {
    try {
      const receipt = parseReceipt(line);
      
      // Filter by user
      if (receipt.slack.user_id !== userId) {
        continue;
      }

      // Optionally exclude fix receipts
      if (excludeFix && receipt.classification === 'fix') {
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
