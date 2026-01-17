/**
 * Receipt Types and Interfaces
 * 
 * Validates: Requirements 15, 16, 36 (Receipt Creation and Schema)
 */

import type { Classification } from './classification';

/**
 * Extended classification types for receipts
 * Includes 'fix' and 'clarify' in addition to standard classifications
 */
export type ReceiptClassification = Classification | 'fix' | 'clarify';

/**
 * Receipt action types
 */
export type ReceiptActionType = 'commit' | 'email' | 'slack_reply';

/**
 * Receipt action with type and details
 */
export interface ReceiptAction {
  type: ReceiptActionType;
  details: {
    // For commit actions
    repo?: string;
    branch?: string;
    message?: string;
    // For email actions
    provider?: string;
    to?: string;
    subject?: string;
    // For slack_reply actions
    channel_id?: string;
    prompt?: string;
  };
}

/**
 * Slack context in receipt
 */
export interface ReceiptSlackContext {
  user_id: string;
  channel_id: string;
  message_ts: string;
}

/**
 * Receipt schema (JSON Lines format)
 * 
 * Validates: Requirement 36 (Receipt Schema)
 */
export interface Receipt {
  /** ISO 8601 timestamp */
  timestamp_iso: string;
  
  /** Slack event ID (idempotency key) */
  event_id: string;
  
  /** Slack context */
  slack: ReceiptSlackContext;
  
  /** Classification type */
  classification: ReceiptClassification;
  
  /** Confidence score (0.0 to 1.0) */
  confidence: number;
  
  /** Actions taken */
  actions: ReceiptAction[];
  
  /** Files affected */
  files: string[];
  
  /** Commit ID (null if no commit) */
  commit_id: string | null;
  
  /** Prior commit ID (for fix operations) */
  prior_commit_id: string | null;
  
  /** System prompt commit ID */
  prompt_commit_id: string;
  
  /** System prompt SHA-256 hash */
  prompt_sha256: string;
  
  /** Human-readable summary */
  summary: string;
  
  /** Validation errors (if Action Plan validation failed) */
  validation_errors?: string[];
}

/**
 * Serialize a receipt to JSON Lines format (single line)
 */
export function serializeReceipt(receipt: Receipt): string {
  return JSON.stringify(receipt);
}

/**
 * Parse a receipt from JSON Lines format
 */
export function parseReceipt(line: string): Receipt {
  return JSON.parse(line) as Receipt;
}

/**
 * Validate receipt has all required fields
 */
export function isValidReceipt(receipt: unknown): receipt is Receipt {
  if (typeof receipt !== 'object' || receipt === null) return false;
  
  const r = receipt as Record<string, unknown>;
  
  return (
    typeof r.timestamp_iso === 'string' &&
    typeof r.event_id === 'string' &&
    typeof r.slack === 'object' &&
    r.slack !== null &&
    typeof (r.slack as Record<string, unknown>).user_id === 'string' &&
    typeof (r.slack as Record<string, unknown>).channel_id === 'string' &&
    typeof (r.slack as Record<string, unknown>).message_ts === 'string' &&
    typeof r.classification === 'string' &&
    typeof r.confidence === 'number' &&
    r.confidence >= 0 &&
    r.confidence <= 1 &&
    Array.isArray(r.actions) &&
    Array.isArray(r.files) &&
    (r.commit_id === null || typeof r.commit_id === 'string') &&
    (r.prior_commit_id === null || typeof r.prior_commit_id === 'string') &&
    typeof r.prompt_commit_id === 'string' &&
    typeof r.prompt_sha256 === 'string' &&
    typeof r.summary === 'string'
  );
}
