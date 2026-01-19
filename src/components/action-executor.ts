/**
 * Action Plan Executor Component
 * 
 * Executes side effects in order: CodeCommit → SES → Slack
 * Handles rate limiting, partial failures, and recovery.
 * 
 * Validates: Requirements 43, 44, 50
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { ActionPlan, ValidationResult } from './action-plan';
import { validateActionPlan } from './action-plan';
import {
  writeFile,
  appendToFile,
  getLatestCommitId,
  type KnowledgeStoreConfig,
  type CommitResult,
} from './knowledge-store';
import {
  updateExecutionState,
  markPartialFailure,
  getCompletedSteps,
  type IdempotencyConfig,
  type CompletedSteps,
} from './idempotency-guard';
import {
  createReceipt,
  appendReceipt,
  type Receipt,
  type ReceiptAction,
  type SlackContext,
} from './receipt-logger';
import type { SystemPromptMetadata } from './system-prompt-loader';

// Execution configuration
export interface ExecutorConfig {
  knowledgeStore: KnowledgeStoreConfig;
  idempotency: IdempotencyConfig;
  sesRegion: string;
  slackBotTokenParam: string;
  mailDropParam: string;
  emailMode: 'live' | 'log';
  senderEmail: string;
}

// Execution result
export interface ExecutionResult {
  success: boolean;
  commitId?: string;
  receiptCommitId?: string;
  slackReplyTs?: string;
  emailMessageId?: string;
  error?: string;
  validationErrors?: string[];
  completedSteps: CompletedSteps;
}

// Rate limit configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

// AWS clients
const sesClient = new SESClient({});
const ssmClient = new SSMClient({});

// Cached SSM values
let cachedBotToken: string | null = null;
let cachedMailDrop: string | null = null;

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number, retryAfter?: number): number {
  if (retryAfter) {
    return Math.min(retryAfter * 1000, MAX_DELAY_MS);
  }
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * Get Slack bot token from SSM
 */
async function getBotToken(paramName: string): Promise<string> {
  if (cachedBotToken) return cachedBotToken;

  const response = await ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    })
  );

  cachedBotToken = response.Parameter?.Value || '';
  return cachedBotToken;
}

/**
 * Get OmniFocus Mail Drop email from SSM
 */
async function getMailDropEmail(paramName: string): Promise<string> {
  if (cachedMailDrop) return cachedMailDrop;

  const response = await ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    })
  );

  cachedMailDrop = response.Parameter?.Value || '';
  return cachedMailDrop;
}

/**
 * Execute CodeCommit file operations
 * 
 * Validates: Requirements 44.1, 44a.3
 */
async function executeCodeCommitOperations(
  config: KnowledgeStoreConfig,
  plan: ActionPlan
): Promise<CommitResult | null> {
  if (plan.file_operations.length === 0) {
    return null;
  }

  let lastCommit: CommitResult | null = null;

  for (const op of plan.file_operations) {
    const parentCommitId = await getLatestCommitId(config);

    if (op.operation === 'append') {
      lastCommit = await appendToFile(
        config,
        op.path,
        op.content,
        `${plan.classification}: ${plan.title}`
      );
    } else {
      lastCommit = await writeFile(
        config,
        { path: op.path, content: op.content, mode: op.operation },
        `${plan.classification}: ${plan.title}`,
        parentCommitId
      );
    }
  }

  return lastCommit;
}

/**
 * Send task email via SES with retry
 * 
 * Validates: Requirements 50.4, 50.5
 */
async function sendTaskEmail(
  config: ExecutorConfig,
  plan: ActionPlan
): Promise<string | null> {
  if (plan.classification !== 'task') {
    return null;
  }

  // Construct task_details from plan if missing
  const taskDetails = plan.task_details || {
    title: plan.title,
    context: plan.content || plan.title,
  };

  if (config.emailMode === 'log') {
    console.log('Email mode is log, skipping SES send', {
      subject: taskDetails.title,
      context: taskDetails.context,
    });
    return 'log-mode-skipped';
  }

  const mailDropEmail = await getMailDropEmail(config.mailDropParam);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await sesClient.send(
        new SendEmailCommand({
          Source: config.senderEmail,
          Destination: {
            ToAddresses: [mailDropEmail],
          },
          Message: {
            Subject: {
              Data: taskDetails.title,
              Charset: 'UTF-8',
            },
            Body: {
              Text: {
                Data: taskDetails.context || plan.content,
                Charset: 'UTF-8',
              },
            },
          },
        })
      );

      return response.MessageId || null;
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number }; retryAfterSeconds?: number };
      
      // Check for throttling
      if (err.name === 'Throttling' || err.$metadata?.httpStatusCode === 429) {
        if (attempt < MAX_RETRIES - 1) {
          const delay = calculateBackoff(attempt, err.retryAfterSeconds);
          console.warn('SES throttled, retrying', { attempt, delay });
          await sleep(delay);
          continue;
        }
      }
      throw error;
    }
  }

  return null;
}

/**
 * Send Slack reply with retry
 * 
 * Validates: Requirements 50.1, 50.2, 50.3
 */
async function sendSlackReply(
  config: ExecutorConfig,
  slackContext: SlackContext,
  message: string
): Promise<string | null> {
  const botToken = await getBotToken(config.slackBotTokenParam);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
          channel: slackContext.channel_id,
          text: message,
          thread_ts: slackContext.message_ts,
        }),
      });

      // Check for rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
        if (attempt < MAX_RETRIES - 1) {
          const delay = calculateBackoff(attempt, retryAfter);
          console.warn('Slack rate limited, retrying', { attempt, delay });
          await sleep(delay);
          continue;
        }
        throw new Error('Slack rate limit exceeded');
      }

      const data = await response.json() as { ok: boolean; ts?: string; error?: string };

      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      return data.ts || null;
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) {
        throw error;
      }
      await sleep(calculateBackoff(attempt));
    }
  }

  return null;
}

/**
 * Format confirmation reply message
 */
function formatConfirmationReply(
  plan: ActionPlan,
  commitId: string | null,
  emailSent: boolean
): string {
  const lines: string[] = [];

  if (plan.classification === 'task' && emailSent) {
    const taskTitle = plan.task_details?.title || plan.title;
    lines.push(`Captured as *${plan.classification}*`);
    lines.push(`Task sent to OmniFocus: "${taskTitle}"`);
  } else {
    lines.push(`Captured as *${plan.classification}*`);
    
    if (plan.file_operations.length > 0) {
      const files = plan.file_operations.map((op) => op.path).join(', ');
      lines.push(`Files: ${files}`);
    }

    if (commitId) {
      lines.push(`Commit: \`${commitId.substring(0, 7)}\``);
    }
  }

  lines.push('');
  lines.push('Reply `fix: <instruction>` to correct.');

  return lines.join('\n');
}

/**
 * Format error reply message
 */
function formatErrorReply(error: string, validationErrors?: string[]): string {
  const lines = ["I couldn't process that message. Please try rephrasing."];

  if (validationErrors && validationErrors.length > 0) {
    lines.push('');
    lines.push(`Errors: ${validationErrors.join(', ')}`);
  } else if (error) {
    lines.push('');
    lines.push(`Error: ${error}`);
  }

  return lines.join('\n');
}

/**
 * Execute Action Plan with side effects
 * 
 * Validates: Requirements 44.1, 44.2, 44a.3, 44b.2, 44b.3, 44c.3
 */
export async function executeActionPlan(
  config: ExecutorConfig,
  eventId: string,
  plan: ActionPlan,
  slackContext: SlackContext,
  promptMetadata?: SystemPromptMetadata
): Promise<ExecutionResult> {
  const completedSteps: CompletedSteps = { codecommit: false, ses: false, slack: false };
  const actions: ReceiptAction[] = [];

  // Validate Action Plan first
  const validation = validateActionPlan(plan);
  if (!validation.valid) {
    // Send error reply to Slack
    const errorMessage = formatErrorReply(
      'Invalid Action Plan',
      validation.errors.map((e) => `${e.field}: ${e.message}`)
    );

    try {
      await sendSlackReply(config, slackContext, errorMessage);
      completedSteps.slack = true;
    } catch (error) {
      console.error('Failed to send error reply', { error });
    }

    // Create failure receipt
    const receipt = createReceipt(
      eventId,
      slackContext,
      plan.classification || 'inbox',
      plan.confidence || 0,
      actions,
      [],
      null,
      'Validation failed',
      {
        validationErrors: validation.errors.map((e) => `${e.field}: ${e.message}`),
        promptCommitId: promptMetadata?.commitId,
        promptSha256: promptMetadata?.sha256,
      }
    );

    try {
      await appendReceipt(config.knowledgeStore, receipt);
    } catch (error) {
      console.error('Failed to write failure receipt', { error });
    }

    return {
      success: false,
      validationErrors: validation.errors.map((e) => `${e.field}: ${e.message}`),
      completedSteps,
    };
  }

  // Check for partial failure recovery
  const priorSteps = await getCompletedSteps(config.idempotency, eventId);

  let commitResult: CommitResult | null = null;
  let emailMessageId: string | null = null;
  let slackReplyTs: string | null = null;

  try {
    // Step 1: CodeCommit (if not already completed)
    if (!priorSteps.codecommit) {
      await updateExecutionState(config.idempotency, eventId, {
        status: 'EXECUTING',
        codecommit_status: 'IN_PROGRESS',
      });

      commitResult = await executeCodeCommitOperations(config.knowledgeStore, plan);
      completedSteps.codecommit = true;

      await updateExecutionState(config.idempotency, eventId, {
        codecommit_status: 'SUCCEEDED',
        commit_id: commitResult?.commitId,
      });

      actions.push({
        type: 'commit',
        status: 'success',
        details: { commitId: commitResult?.commitId, files: plan.file_operations.map((op) => op.path) },
      });
    } else {
      completedSteps.codecommit = true;
      actions.push({ type: 'commit', status: 'skipped', details: { reason: 'already completed' } });
    }

    // Step 2: SES (if task and not already completed)
    if (plan.classification === 'task' && !priorSteps.ses) {
      await updateExecutionState(config.idempotency, eventId, {
        ses_status: 'IN_PROGRESS',
      });

      emailMessageId = await sendTaskEmail(config, plan);
      completedSteps.ses = true;

      await updateExecutionState(config.idempotency, eventId, {
        ses_status: 'SUCCEEDED',
      });

      actions.push({
        type: 'email',
        status: 'success',
        details: { messageId: emailMessageId },
      });
    } else if (plan.classification !== 'task') {
      completedSteps.ses = true;
      actions.push({ type: 'email', status: 'skipped', details: { reason: 'not a task' } });
    } else {
      completedSteps.ses = true;
      actions.push({ type: 'email', status: 'skipped', details: { reason: 'already completed' } });
    }

    // Step 3: Slack reply (if not already completed)
    if (!priorSteps.slack) {
      await updateExecutionState(config.idempotency, eventId, {
        slack_status: 'IN_PROGRESS',
      });

      const replyMessage = formatConfirmationReply(
        plan,
        commitResult?.commitId || null,
        !!emailMessageId
      );
      slackReplyTs = await sendSlackReply(config, slackContext, replyMessage);
      completedSteps.slack = true;

      await updateExecutionState(config.idempotency, eventId, {
        slack_status: 'SUCCEEDED',
      });

      actions.push({
        type: 'slack_reply',
        status: 'success',
        details: { ts: slackReplyTs },
      });
    } else {
      completedSteps.slack = true;
      actions.push({ type: 'slack_reply', status: 'skipped', details: { reason: 'already completed' } });
    }

    // Write receipt
    const receipt = createReceipt(
      eventId,
      slackContext,
      plan.classification || 'inbox',
      plan.confidence,
      actions,
      plan.file_operations.map((op) => op.path),
      commitResult?.commitId || null,
      plan.title,
      {
        promptCommitId: promptMetadata?.commitId,
        promptSha256: promptMetadata?.sha256,
      }
    );

    const receiptResult = await appendReceipt(config.knowledgeStore, receipt);

    return {
      success: true,
      commitId: commitResult?.commitId,
      receiptCommitId: receiptResult.commitId,
      slackReplyTs: slackReplyTs || undefined,
      emailMessageId: emailMessageId || undefined,
      completedSteps,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Execution failed', { eventId, error: errorMessage, completedSteps });

    // Mark partial failure
    await markPartialFailure(config.idempotency, eventId, errorMessage, completedSteps);

    // Try to send error reply if Slack step not completed
    if (!completedSteps.slack) {
      try {
        await sendSlackReply(config, slackContext, formatErrorReply(errorMessage));
      } catch {
        // Ignore error reply failure
      }
    }

    return {
      success: false,
      error: errorMessage,
      completedSteps,
    };
  }
}
