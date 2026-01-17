/**
 * Execution State Types and Interfaces
 * 
 * Validates: Requirements 44a, 44b, 44c (Execution State Tracking, Partial Failure Handling)
 */

/**
 * Execution status values
 * 
 * RECEIVED: Event received, not yet processed
 * PLANNED: AgentCore returned Action Plan
 * EXECUTING: Side effects in progress
 * PARTIAL_FAILURE: Some side effects succeeded, some failed
 * SUCCEEDED: All side effects completed
 * FAILED_PERMANENT: Unrecoverable failure, no side effects executed
 */
export type ExecutionStatus =
  | 'RECEIVED'
  | 'PLANNED'
  | 'EXECUTING'
  | 'PARTIAL_FAILURE'
  | 'SUCCEEDED'
  | 'FAILED_PERMANENT';

/**
 * Step status values
 */
export type StepStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'skipped';

/**
 * Per-step status tracking
 */
export interface StepStatuses {
  codecommit_status: StepStatus;
  ses_status: StepStatus;
  slack_status: StepStatus;
}

/**
 * Execution record stored in DynamoDB
 * 
 * Validates: Requirement 44a (Execution State Tracking)
 */
export interface ExecutionRecord {
  /** Partition key: Slack event_id */
  event_id: string;
  
  /** Overall execution status */
  status: ExecutionStatus;
  
  /** Per-step status */
  codecommit_status: StepStatus;
  ses_status: StepStatus;
  slack_status: StepStatus;
  
  /** Last error message */
  last_error?: string;
  
  /** Last update timestamp (ISO 8601) */
  updated_at: string;
  
  /** TTL for DynamoDB (Unix timestamp) */
  expires_at: number;
  
  /** Optional retry scheduling */
  retry_after?: string; // ISO 8601 timestamp
  
  /** Action Plan (stored for retry) */
  action_plan?: string; // JSON string
  
  /** Commit ID if CodeCommit succeeded */
  commit_id?: string;
  
  /** Email message ID if SES succeeded */
  email_message_id?: string;
  
  /** Slack reply timestamp if Slack succeeded */
  slack_reply_ts?: string;
}

/**
 * Create initial execution record
 */
export function createExecutionRecord(
  eventId: string,
  ttlDays: number = 7
): ExecutionRecord {
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + ttlDays * 24 * 60 * 60;
  
  return {
    event_id: eventId,
    status: 'RECEIVED',
    codecommit_status: 'pending',
    ses_status: 'pending',
    slack_status: 'pending',
    updated_at: now.toISOString(),
    expires_at: expiresAt,
  };
}

/**
 * Get completed steps from execution record
 * 
 * Validates: Requirement 44b (Partial Failure Handling)
 */
export function getCompletedSteps(record: ExecutionRecord): Set<keyof StepStatuses> {
  const completed = new Set<keyof StepStatuses>();
  
  if (record.codecommit_status === 'succeeded') {
    completed.add('codecommit_status');
  }
  if (record.ses_status === 'succeeded') {
    completed.add('ses_status');
  }
  if (record.slack_status === 'succeeded') {
    completed.add('slack_status');
  }
  
  return completed;
}

/**
 * Determine if execution can be retried
 */
export function canRetry(record: ExecutionRecord): boolean {
  return record.status === 'PARTIAL_FAILURE';
}

/**
 * Get first failed step for retry
 */
export function getFirstFailedStep(record: ExecutionRecord): keyof StepStatuses | null {
  // Steps are executed in order: codecommit → ses → slack
  if (record.codecommit_status === 'failed') return 'codecommit_status';
  if (record.ses_status === 'failed') return 'ses_status';
  if (record.slack_status === 'failed') return 'slack_status';
  return null;
}
