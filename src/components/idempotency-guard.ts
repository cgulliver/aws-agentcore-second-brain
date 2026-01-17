/**
 * Idempotency Guard Component
 * 
 * Provides exactly-once semantics using DynamoDB conditional writes.
 * Tracks execution state for partial failure recovery.
 * 
 * Validates: Requirements 19-22, 24a, 44a, 44b, 44c
 */

import {
  DynamoDBClient,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

// Execution status enum
export type ExecutionStatus =
  | 'RECEIVED'
  | 'PLANNED'
  | 'EXECUTING'
  | 'PARTIAL_FAILURE'
  | 'SUCCEEDED'
  | 'FAILED_PERMANENT';

// Step status enum
export type StepStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

// Execution state record
export interface ExecutionState {
  event_id: string;
  status: ExecutionStatus;
  codecommit_status: StepStatus;
  ses_status: StepStatus;
  slack_status: StepStatus;
  last_error?: string;
  updated_at: string;
  created_at: string;
  expires_at: number;
  retry_after?: string;
  commit_id?: string;
  receipt_commit_id?: string;
}

// Completed steps for partial failure recovery
export interface CompletedSteps {
  codecommit: boolean;
  ses: boolean;
  slack: boolean;
}

// Configuration
export interface IdempotencyConfig {
  tableName: string;
  ttlDays: number;
}

// Default TTL: 7 days
const DEFAULT_TTL_DAYS = 7;

// DynamoDB client
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * Calculate TTL timestamp (Unix seconds)
 */
function calculateTTL(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
}

/**
 * Try to acquire lock for event processing
 * Uses conditional write to ensure exactly-once semantics
 * 
 * Validates: Requirements 21.2, 21.3, 24a.4
 * 
 * @returns true if lock acquired, false if duplicate
 */
export async function tryAcquireLock(
  config: IdempotencyConfig,
  eventId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const ttl = calculateTTL(config.ttlDays || DEFAULT_TTL_DAYS);

  try {
    await docClient.send(
      new PutCommand({
        TableName: config.tableName,
        Item: {
          event_id: eventId,
          status: 'RECEIVED' as ExecutionStatus,
          codecommit_status: 'PENDING' as StepStatus,
          ses_status: 'PENDING' as StepStatus,
          slack_status: 'PENDING' as StepStatus,
          created_at: now,
          updated_at: now,
          expires_at: ttl,
        },
        ConditionExpression: 'attribute_not_exists(event_id)',
      })
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Record already exists - duplicate event
      return false;
    }
    throw error;
  }
}

/**
 * Update execution state
 * 
 * Validates: Requirements 44a.1-44a.5
 */
export async function updateExecutionState(
  config: IdempotencyConfig,
  eventId: string,
  updates: Partial<Omit<ExecutionState, 'event_id' | 'created_at' | 'expires_at'>>
): Promise<void> {
  const now = new Date().toISOString();

  // Build update expression dynamically
  const updateParts: string[] = ['#updated_at = :updated_at'];
  const expressionNames: Record<string, string> = { '#updated_at': 'updated_at' };
  const expressionValues: Record<string, unknown> = { ':updated_at': now };

  if (updates.status !== undefined) {
    updateParts.push('#status = :status');
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = updates.status;
  }

  if (updates.codecommit_status !== undefined) {
    updateParts.push('#codecommit_status = :codecommit_status');
    expressionNames['#codecommit_status'] = 'codecommit_status';
    expressionValues[':codecommit_status'] = updates.codecommit_status;
  }

  if (updates.ses_status !== undefined) {
    updateParts.push('#ses_status = :ses_status');
    expressionNames['#ses_status'] = 'ses_status';
    expressionValues[':ses_status'] = updates.ses_status;
  }

  if (updates.slack_status !== undefined) {
    updateParts.push('#slack_status = :slack_status');
    expressionNames['#slack_status'] = 'slack_status';
    expressionValues[':slack_status'] = updates.slack_status;
  }

  if (updates.last_error !== undefined) {
    updateParts.push('#last_error = :last_error');
    expressionNames['#last_error'] = 'last_error';
    expressionValues[':last_error'] = updates.last_error;
  }

  if (updates.retry_after !== undefined) {
    updateParts.push('#retry_after = :retry_after');
    expressionNames['#retry_after'] = 'retry_after';
    expressionValues[':retry_after'] = updates.retry_after;
  }

  if (updates.commit_id !== undefined) {
    updateParts.push('#commit_id = :commit_id');
    expressionNames['#commit_id'] = 'commit_id';
    expressionValues[':commit_id'] = updates.commit_id;
  }

  if (updates.receipt_commit_id !== undefined) {
    updateParts.push('#receipt_commit_id = :receipt_commit_id');
    expressionNames['#receipt_commit_id'] = 'receipt_commit_id';
    expressionValues[':receipt_commit_id'] = updates.receipt_commit_id;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: { event_id: eventId },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
    })
  );
}

/**
 * Mark execution as completed successfully
 * 
 * Validates: Requirements 20, 22
 */
export async function markCompleted(
  config: IdempotencyConfig,
  eventId: string,
  commitId?: string,
  receiptCommitId?: string
): Promise<void> {
  await updateExecutionState(config, eventId, {
    status: 'SUCCEEDED',
    codecommit_status: 'SUCCEEDED',
    ses_status: 'SUCCEEDED',
    slack_status: 'SUCCEEDED',
    commit_id: commitId,
    receipt_commit_id: receiptCommitId,
  });
}

/**
 * Mark execution as failed permanently
 * 
 * Validates: Requirements 20, 22
 */
export async function markFailed(
  config: IdempotencyConfig,
  eventId: string,
  error: string
): Promise<void> {
  await updateExecutionState(config, eventId, {
    status: 'FAILED_PERMANENT',
    last_error: error,
  });
}

/**
 * Mark execution as partial failure
 * 
 * Validates: Requirements 44b.1
 */
export async function markPartialFailure(
  config: IdempotencyConfig,
  eventId: string,
  error: string,
  completedSteps: CompletedSteps
): Promise<void> {
  await updateExecutionState(config, eventId, {
    status: 'PARTIAL_FAILURE',
    last_error: error,
    codecommit_status: completedSteps.codecommit ? 'SUCCEEDED' : 'FAILED',
    ses_status: completedSteps.ses ? 'SUCCEEDED' : 'PENDING',
    slack_status: completedSteps.slack ? 'SUCCEEDED' : 'PENDING',
  });
}

/**
 * Check if event has already been processed successfully
 * 
 * Validates: Requirements 19, 20, 22
 */
export async function isProcessed(
  config: IdempotencyConfig,
  eventId: string
): Promise<boolean> {
  const result = await docClient.send(
    new GetCommand({
      TableName: config.tableName,
      Key: { event_id: eventId },
      ProjectionExpression: '#status',
      ExpressionAttributeNames: { '#status': 'status' },
    })
  );

  if (!result.Item) {
    return false;
  }

  return result.Item.status === 'SUCCEEDED';
}

/**
 * Get current execution state
 * 
 * Validates: Requirements 44b.2
 */
export async function getExecutionState(
  config: IdempotencyConfig,
  eventId: string
): Promise<ExecutionState | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: config.tableName,
      Key: { event_id: eventId },
    })
  );

  return (result.Item as ExecutionState) || null;
}

/**
 * Get completed steps for partial failure recovery
 * 
 * Validates: Requirements 44b.3, 44c.1-44c.4
 */
export async function getCompletedSteps(
  config: IdempotencyConfig,
  eventId: string
): Promise<CompletedSteps> {
  const state = await getExecutionState(config, eventId);

  if (!state) {
    return { codecommit: false, ses: false, slack: false };
  }

  return {
    codecommit: state.codecommit_status === 'SUCCEEDED',
    ses: state.ses_status === 'SUCCEEDED',
    slack: state.slack_status === 'SUCCEEDED',
  };
}

/**
 * Check if execution can be retried (partial failure state)
 */
export async function canRetry(
  config: IdempotencyConfig,
  eventId: string
): Promise<boolean> {
  const state = await getExecutionState(config, eventId);

  if (!state) {
    return false;
  }

  return state.status === 'PARTIAL_FAILURE';
}
