/**
 * Worker Lambda Handler (v2.1)
 * 
 * Processes Slack events from SQS:
 * - Idempotency check (DynamoDB)
 * - Load system prompt (CodeCommit)
 * - Invoke AgentCore Runtime for classification
 * - Validate Action Plan
 * - Execute side effects: CodeCommit → SES → Slack
 * - Write receipt
 * 
 * Validates: Requirements 3, 6, 11, 15, 17, 19-22, 42-44
 */

import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import type { SQSEventMessage, Classification } from '../types';
import {
  tryAcquireLock,
  updateExecutionState,
  markCompleted,
  markFailed,
  type IdempotencyConfig,
} from '../components/idempotency-guard';
import {
  loadSystemPrompt,
  type SystemPromptConfig,
} from '../components/system-prompt-loader';
import {
  invokeAgentRuntime,
  shouldAskClarification,
  generateClarificationPrompt,
  type AgentCoreConfig,
} from '../components/agentcore-client';
import {
  validateActionPlan,
  type ActionPlan,
} from '../components/action-plan';
import {
  executeActionPlan,
  type ExecutorConfig,
} from '../components/action-executor';
import {
  createReceipt,
  appendReceipt,
  type SlackContext,
} from '../components/receipt-logger';
import {
  getContext,
  setContext,
  deleteContext,
  type ConversationStoreConfig,
} from '../components/conversation-context';
import {
  formatConfirmationReply,
  formatClarificationReply,
  formatErrorReply,
  sendSlackReply,
} from '../components/slack-responder';
import {
  parseFixCommand,
  getFixableReceipt,
  applyFix,
  canApplyFix,
} from '../components/fix-handler';
import {
  findMatchingProject,
  type ProjectMatcherConfig,
} from '../components/project-matcher';
import type { KnowledgeStoreConfig } from '../components/knowledge-store';
import {
  searchKnowledgeBase,
  type KnowledgeSearchConfig,
} from '../components/knowledge-search';
import {
  processQuery,
  buildQueryPrompt,
  generateNoResultsResponse,
  formatQuerySlackReply,
  validateResponseCitations,
  queryProjectsByStatus,
  formatProjectQueryForSlack,
} from '../components/query-handler';
import {
  updateProjectStatus,
} from '../components/project-status-updater';
import type { ProjectStatus } from '../components/action-plan';
import {
  appendTaskLog,
} from '../components/task-logger';
import type { ProjectStatus } from '../components/action-plan';
import { log, redactPII } from './logging';
import { createHash } from 'crypto';

// Environment variables
const REPOSITORY_NAME = process.env.REPOSITORY_NAME!;
const IDEMPOTENCY_TABLE = process.env.IDEMPOTENCY_TABLE!;
const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE!;
const AGENT_RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN!;
const BOT_TOKEN_PARAM = process.env.BOT_TOKEN_PARAM || '/second-brain/slack-bot-token';
const MAILDROP_PARAM = process.env.MAILDROP_PARAM || '/second-brain/omnifocus-maildrop-email';
const CONVERSATION_TTL_PARAM = process.env.CONVERSATION_TTL_PARAM || '/second-brain/conversation-ttl-seconds';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@example.com';
const EMAIL_MODE = process.env.EMAIL_MODE || 'live';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Configuration objects
const idempotencyConfig: IdempotencyConfig = {
  tableName: IDEMPOTENCY_TABLE,
  ttlDays: 7,
};

const knowledgeConfig: KnowledgeStoreConfig = {
  repositoryName: REPOSITORY_NAME,
  branchName: 'main',
};

const conversationConfig: ConversationStoreConfig = {
  tableName: CONVERSATION_TABLE,
  ttlParam: CONVERSATION_TTL_PARAM,
};

const agentConfig: AgentCoreConfig = {
  agentRuntimeArn: AGENT_RUNTIME_ARN,
  region: AWS_REGION,
};

const systemPromptConfig: SystemPromptConfig = {
  repositoryName: REPOSITORY_NAME,
  branchName: 'main',
  promptPath: 'system/agent-system-prompt.md',
};

// Project matcher configuration
const projectMatcherConfig: ProjectMatcherConfig = {
  repositoryName: REPOSITORY_NAME,
  branchName: 'main',
  minConfidence: 0.5,
  autoLinkConfidence: 0.7,
  maxCandidates: 3,
};

// Cached system prompt
let cachedSystemPrompt: { content: string; metadata: { commitId: string; sha256: string } } | null = null;

/**
 * Load system prompt (cached for Lambda lifetime)
 */
async function getSystemPrompt(): Promise<{ content: string; metadata: { commitId: string; sha256: string } }> {
  if (cachedSystemPrompt) {
    return cachedSystemPrompt;
  }

  const result = await loadSystemPrompt(systemPromptConfig);
  cachedSystemPrompt = {
    content: result.content,
    metadata: {
      commitId: result.metadata.commitId,
      sha256: result.metadata.sha256,
    },
  };
  
  log('info', 'System prompt loaded', {
    hash: result.metadata.sha256.substring(0, 8),
    commitId: result.metadata.commitId,
  });

  return cachedSystemPrompt;
}

/**
 * Process a single SQS message
 * 
 * Validates: Requirements 3.3, 6, 11, 15, 17, 19-22, 42-44
 */
async function processMessage(message: SQSEventMessage): Promise<void> {
  const { event_id, user_id, channel_id, message_text, message_ts, thread_ts } = message;

  log('info', 'Processing message', {
    event_id,
    user_id: redactPII(user_id),
    channel_id,
  });

  // Build Slack context
  const slackContext: SlackContext = {
    user_id,
    channel_id,
    message_ts,
    thread_ts,
  };

  // Step 1: Idempotency check
  const lockAcquired = await tryAcquireLock(idempotencyConfig, event_id);
  if (!lockAcquired) {
    log('info', 'Duplicate event, skipping', { event_id });
    return;
  }

  await updateExecutionState(idempotencyConfig, event_id, { status: 'RECEIVED' });

  try {
    // Step 2: Check for fix command
    const fixCommand = parseFixCommand(message_text);
    if (fixCommand.isFixCommand) {
      await handleFixCommand(event_id, slackContext, fixCommand.instruction);
      return;
    }

    // Step 3: Check for existing conversation context (clarification response)
    const existingContext = await getContext(conversationConfig, channel_id, user_id);
    if (existingContext) {
      await handleClarificationResponse(event_id, slackContext, message_text, existingContext);
      return;
    }

    // Step 4: Load system prompt
    const systemPrompt = await getSystemPrompt();

    // Step 5: Invoke AgentCore for classification
    await updateExecutionState(idempotencyConfig, event_id, { status: 'PLANNED' });

    const agentResult = await invokeAgentRuntime(agentConfig, {
      prompt: message_text,
      system_prompt: systemPrompt.content,
      session_id: `${channel_id}#${user_id}`,
    });

    if (!agentResult.success || !agentResult.actionPlan) {
      throw new Error(agentResult.error || 'AgentCore invocation failed');
    }

    const actionPlan = agentResult.actionPlan;

    log('info', 'Classification result', {
      event_id,
      intent: actionPlan.intent,
      intent_confidence: actionPlan.intent_confidence,
      classification: actionPlan.classification,
      confidence: actionPlan.confidence,
      has_query_response: !!actionPlan.query_response,
      has_cited_files: !!actionPlan.cited_files,
    });

    // Step 6: Validate Action Plan
    const validation = validateActionPlan(actionPlan);
    if (!validation.valid) {
      log('warn', 'Validation errors', {
        event_id,
        errors: validation.errors,
        actionPlan: JSON.stringify(actionPlan).substring(0, 1000),
      });
      await handleValidationFailure(event_id, slackContext, validation.errors.map(e => e.message));
      return;
    }

    // Step 6.5: Check for query intent (Phase 2)
    if (actionPlan.intent === 'query') {
      await handleQueryIntent(event_id, slackContext, message_text, actionPlan, systemPrompt);
      return;
    }

    // Step 6.6: Check for status_update intent
    if (actionPlan.intent === 'status_update' && actionPlan.status_update) {
      await handleStatusUpdate(event_id, slackContext, actionPlan);
      return;
    }

    // Step 7: Check if clarification needed (only for capture intent)
    if (actionPlan.classification && shouldAskClarification(actionPlan.confidence, actionPlan.classification)) {
      await handleLowConfidence(event_id, slackContext, message_text, actionPlan);
      return;
    }

    // Step 8: Execute side effects
    await executeAndFinalize(event_id, slackContext, actionPlan, systemPrompt);

  } catch (error) {
    log('error', 'Processing failed', {
      event_id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    await markFailed(idempotencyConfig, event_id, error instanceof Error ? error.message : 'Unknown error');

    // Send error reply to user
    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: channel_id,
        text: formatErrorReply('Processing failed. Please try again.'),
        thread_ts,
      }
    );

    throw error;
  }
}

/**
 * Handle fix command
 */
async function handleFixCommand(
  eventId: string,
  slackContext: SlackContext,
  instruction: string
): Promise<void> {
  log('info', 'Processing fix command', { event_id: eventId });

  // Get the most recent fixable receipt
  const priorReceipt = await getFixableReceipt(knowledgeConfig, slackContext.user_id);
  const canFix = canApplyFix(priorReceipt);

  if (!canFix.canFix) {
    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: slackContext.channel_id,
        text: formatErrorReply(canFix.reason || 'Cannot apply fix'),
        thread_ts: slackContext.thread_ts,
      }
    );
    await markFailed(idempotencyConfig, eventId, canFix.reason || 'Cannot apply fix');
    return;
  }

  // Apply the fix
  const systemPrompt = await getSystemPrompt();
  const fixResult = await applyFix(
    knowledgeConfig,
    agentConfig,
    priorReceipt!,
    instruction,
    systemPrompt.content
  );

  if (!fixResult.success) {
    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: slackContext.channel_id,
        text: formatErrorReply(fixResult.error || 'Fix failed'),
        thread_ts: slackContext.thread_ts,
      }
    );
    await markFailed(idempotencyConfig, eventId, fixResult.error || 'Fix failed');
    return;
  }

  // Create receipt for fix
  const receipt = createReceipt(
    eventId,
    slackContext,
    'fix',
    1.0,
    [{ type: 'commit', status: 'success', details: { commitId: fixResult.commitId } }],
    fixResult.filesModified || [],
    fixResult.commitId || null,
    `Fix applied: ${instruction.substring(0, 50)}`,
    { priorCommitId: fixResult.priorCommitId }
  );

  await appendReceipt(knowledgeConfig, receipt);

  // Send confirmation
  await sendSlackReply(
    { botTokenParam: BOT_TOKEN_PARAM },
    {
      channel: slackContext.channel_id,
      text: formatConfirmationReply('fix', fixResult.filesModified || [], fixResult.commitId || null),
      thread_ts: slackContext.thread_ts,
    }
  );

  await markCompleted(idempotencyConfig, eventId);
  log('info', 'Fix completed', { event_id: eventId, commit_id: fixResult.commitId });
}

/**
 * Handle clarification response
 */
async function handleClarificationResponse(
  eventId: string,
  slackContext: SlackContext,
  responseText: string,
  context: Awaited<ReturnType<typeof getContext>>
): Promise<void> {
  if (!context) return;

  log('info', 'Processing clarification response', { event_id: eventId });

  // Check if response is a reclassify command
  const reclassifyMatch = responseText.match(/^reclassify:\s*(\w+)$/i);
  let classification: Classification;

  if (reclassifyMatch) {
    classification = reclassifyMatch[1].toLowerCase() as Classification;
  } else {
    // Try to match response to classification options
    const validClassifications: Classification[] = ['inbox', 'idea', 'decision', 'project', 'task'];
    const matchedClassification = validClassifications.find(
      c => responseText.toLowerCase().includes(c)
    );
    classification = matchedClassification || 'inbox';
  }

  // Clear conversation context
  await deleteContext(conversationConfig, slackContext.channel_id, slackContext.user_id);

  // Re-process with forced classification
  const systemPrompt = await getSystemPrompt();
  const agentResult = await invokeAgentRuntime(agentConfig, {
    prompt: `Classify this as "${classification}": ${context.original_message}`,
    system_prompt: systemPrompt.content,
    session_id: `${slackContext.channel_id}#${slackContext.user_id}`,
  });

  if (!agentResult.success || !agentResult.actionPlan) {
    throw new Error(agentResult.error || 'AgentCore invocation failed');
  }

  // Override classification with user's choice
  const actionPlan = {
    ...agentResult.actionPlan,
    classification,
    confidence: 1.0, // User confirmed
  };

  await executeAndFinalize(eventId, slackContext, actionPlan, systemPrompt);
}

/**
 * Handle low confidence - ask for clarification
 */
async function handleLowConfidence(
  eventId: string,
  slackContext: SlackContext,
  originalMessage: string,
  actionPlan: ActionPlan
): Promise<void> {
  log('info', 'Low confidence, asking clarification', {
    event_id: eventId,
    confidence: actionPlan.confidence,
  });

  const classification = actionPlan.classification || 'inbox';

  // Store conversation context
  await setContext(conversationConfig, slackContext.channel_id, slackContext.user_id, {
    original_event_id: eventId,
    original_message: originalMessage,
    original_classification: classification,
    original_confidence: actionPlan.confidence,
    clarification_asked: generateClarificationPrompt(classification, actionPlan.confidence),
  });

  // Send clarification request
  const clarificationText = formatClarificationReply(
    "I'm not sure how to classify this. Is it:",
    ['inbox', 'idea', 'decision', 'project', 'task']
  );

  await sendSlackReply(
    { botTokenParam: BOT_TOKEN_PARAM },
    {
      channel: slackContext.channel_id,
      text: clarificationText,
      thread_ts: slackContext.thread_ts,
    }
  );

  // Create receipt for clarification
  const receipt = createReceipt(
    eventId,
    slackContext,
    'clarify',
    actionPlan.confidence,
    [{ type: 'slack_reply', status: 'success', details: { type: 'clarification' } }],
    [],
    null,
    'Clarification requested'
  );

  await appendReceipt(knowledgeConfig, receipt);
  await markCompleted(idempotencyConfig, eventId);
}

/**
 * Handle validation failure
 */
async function handleValidationFailure(
  eventId: string,
  slackContext: SlackContext,
  errors: string[]
): Promise<void> {
  log('warn', 'Action plan validation failed', { event_id: eventId, errors });

  await sendSlackReply(
    { botTokenParam: BOT_TOKEN_PARAM },
    {
      channel: slackContext.channel_id,
      text: formatErrorReply('Invalid response from classifier', errors),
      thread_ts: slackContext.thread_ts,
    }
  );

  // Create failure receipt
  const receipt = createReceipt(
    eventId,
    slackContext,
    'inbox', // Default
    0,
    [],
    [],
    null,
    'Validation failed',
    { validationErrors: errors }
  );

  await appendReceipt(knowledgeConfig, receipt);
  await markFailed(idempotencyConfig, eventId, `Validation failed: ${errors.join(', ')}`);
}

/**
 * Detect if a query is asking about projects by status
 * Returns the status being queried, or null if not a status query
 */
function detectProjectStatusQuery(queryText: string): ProjectStatus | null {
  const text = queryText.toLowerCase();
  
  // Patterns for status queries
  const patterns: Array<{ pattern: RegExp; status: ProjectStatus }> = [
    { pattern: /(?:show|list|what|which).*(?:active|current)\s*projects?/i, status: 'active' },
    { pattern: /(?:show|list|what|which).*(?:on-hold|on hold|paused)\s*projects?/i, status: 'on-hold' },
    { pattern: /(?:show|list|what|which).*(?:complete|completed|done|finished)\s*projects?/i, status: 'complete' },
    { pattern: /(?:show|list|what|which).*(?:cancelled|canceled|dropped)\s*projects?/i, status: 'cancelled' },
    { pattern: /projects?\s+(?:that\s+)?(?:are\s+)?active/i, status: 'active' },
    { pattern: /projects?\s+(?:that\s+)?(?:are\s+)?(?:on-hold|on hold|paused)/i, status: 'on-hold' },
    { pattern: /projects?\s+(?:that\s+)?(?:are\s+)?(?:complete|completed|done)/i, status: 'complete' },
    { pattern: /projects?\s+(?:that\s+)?(?:are\s+)?(?:cancelled|canceled)/i, status: 'cancelled' },
  ];
  
  for (const { pattern, status } of patterns) {
    if (pattern.test(text)) {
      return status;
    }
  }
  
  return null;
}

/**
 * Handle project status query
 */
async function handleProjectStatusQuery(
  eventId: string,
  slackContext: SlackContext,
  status: ProjectStatus,
  actionPlan: ActionPlan
): Promise<void> {
  log('info', 'Processing project status query', {
    event_id: eventId,
    status,
  });

  try {
    // Search the knowledge base for project files
    const searchConfig: KnowledgeSearchConfig = {
      repositoryName: REPOSITORY_NAME,
      branchName: 'main',
      maxFilesToSearch: 50,
      maxExcerptLength: 500,
    };

    const { CodeCommitClient } = await import('@aws-sdk/client-codecommit');
    const codecommitClient = new CodeCommitClient({ region: AWS_REGION });
    
    const searchResult = await searchKnowledgeBase(codecommitClient, searchConfig);

    // Filter projects by status
    const queryResult = queryProjectsByStatus(searchResult.files, status);

    // Format response
    const responseText = formatProjectQueryForSlack(queryResult, status);

    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: slackContext.channel_id,
        text: responseText,
        thread_ts: slackContext.thread_ts,
      }
    );

    // Create receipt
    const receipt = createReceipt(
      eventId,
      slackContext,
      'query',
      actionPlan.intent_confidence,
      [{ type: 'slack_reply', status: 'success', details: { type: 'project_status_query' } }],
      queryResult.projects.map(p => p.path),
      null,
      `Project status query: ${status}`,
      {
        status,
        projectsFound: queryResult.totalCount,
      }
    );

    await appendReceipt(knowledgeConfig, receipt);
    await markCompleted(idempotencyConfig, eventId);

    log('info', 'Project status query completed', {
      event_id: eventId,
      status,
      projects_found: queryResult.totalCount,
    });

  } catch (error) {
    log('error', 'Project status query failed', {
      event_id: eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: slackContext.channel_id,
        text: formatErrorReply('Failed to query projects. Please try again.'),
        thread_ts: slackContext.thread_ts,
      }
    );

    await markFailed(idempotencyConfig, eventId, error instanceof Error ? error.message : 'Query failed');
    throw error;
  }
}

/**
 * Handle query intent (Phase 2)
 * 
 * Validates: Requirements 53.2, 53.3, 54, 55, 56
 */
async function handleQueryIntent(
  eventId: string,
  slackContext: SlackContext,
  queryText: string,
  actionPlan: ActionPlan,
  systemPrompt: { content: string; metadata: { commitId: string; sha256: string } }
): Promise<void> {
  log('info', 'Processing query intent', {
    event_id: eventId,
    intent_confidence: actionPlan.intent_confidence,
  });

  await updateExecutionState(idempotencyConfig, eventId, { status: 'EXECUTING' });

  try {
    // Check if this is a project status query
    const statusQueryMatch = detectProjectStatusQuery(queryText);
    
    if (statusQueryMatch) {
      await handleProjectStatusQuery(eventId, slackContext, statusQueryMatch, actionPlan);
      return;
    }

    // Search the knowledge base
    const searchConfig: KnowledgeSearchConfig = {
      repositoryName: REPOSITORY_NAME,
      branchName: 'main',
      maxFilesToSearch: 50,
      maxExcerptLength: 500,
    };

    const { CodeCommitClient } = await import('@aws-sdk/client-codecommit');
    const codecommitClient = new CodeCommitClient({ region: AWS_REGION });
    
    const searchResult = await searchKnowledgeBase(codecommitClient, searchConfig);

    // Process query against found files
    const queryResult = processQuery(queryText, searchResult.files);

    let responseText: string;
    let citedFiles: string[] = [];

    if (!queryResult.hasResults) {
      // No relevant results found
      responseText = generateNoResultsResponse(queryText);
    } else {
      // Use AgentCore to generate response from context
      const queryPrompt = buildQueryPrompt(queryText, queryResult.context, queryResult.citedFiles);
      
      const agentResult = await invokeAgentRuntime(agentConfig, {
        prompt: queryPrompt,
        system_prompt: systemPrompt.content,
        session_id: `${slackContext.channel_id}#${slackContext.user_id}`,
      });

      if (agentResult.success && agentResult.actionPlan?.query_response) {
        responseText = agentResult.actionPlan.query_response;
        citedFiles = queryResult.citedFiles.map(f => f.path);
        
        // Validate citations (hallucination guard)
        const citationValidation = validateResponseCitations(responseText, queryResult.citedFiles);
        if (!citationValidation.valid) {
          log('warn', 'Query response citation warnings', {
            event_id: eventId,
            warnings: citationValidation.warnings,
          });
        }
      } else {
        // Fallback: use the excerpts directly
        responseText = queryResult.citedFiles
          .map(f => `From \`${f.path}\`:\n${f.excerpt}`)
          .join('\n\n');
        citedFiles = queryResult.citedFiles.map(f => f.path);
      }
    }

    // Format and send Slack reply
    const slackReply = formatQuerySlackReply(responseText, queryResult.citedFiles);
    
    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: slackContext.channel_id,
        text: slackReply,
        thread_ts: slackContext.thread_ts,
      }
    );

    // Create query receipt (hash query for PII protection)
    const queryHash = createHash('sha256').update(queryText).digest('hex').substring(0, 16);
    
    const receipt = createReceipt(
      eventId,
      slackContext,
      'query', // ExtendedClassification for Phase 2
      actionPlan.intent_confidence,
      [{ type: 'slack_reply', status: 'success', details: { type: 'query_response' } }],
      citedFiles,
      null, // No commit for queries
      `Query processed: ${queryHash}`,
      {
        queryHash,
        filesSearched: searchResult.totalFilesSearched,
        filesCited: citedFiles.length,
      }
    );

    await appendReceipt(knowledgeConfig, receipt);
    await markCompleted(idempotencyConfig, eventId);

    log('info', 'Query completed', {
      event_id: eventId,
      files_searched: searchResult.totalFilesSearched,
      files_cited: citedFiles.length,
    });

  } catch (error) {
    log('error', 'Query processing failed', {
      event_id: eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: slackContext.channel_id,
        text: formatErrorReply('Failed to search knowledge base. Please try again.'),
        thread_ts: slackContext.thread_ts,
      }
    );

    await markFailed(idempotencyConfig, eventId, error instanceof Error ? error.message : 'Query failed');
    throw error;
  }
}

/**
 * Handle status update intent
 * 
 * Validates: Requirements 3.3, 3.5, 4.1, 8.1, 8.2, 8.3
 */
async function handleStatusUpdate(
  eventId: string,
  slackContext: SlackContext,
  actionPlan: ActionPlan
): Promise<void> {
  log('info', 'Processing status update intent', {
    event_id: eventId,
    project_reference: actionPlan.status_update?.project_reference,
    target_status: actionPlan.status_update?.target_status,
  });

  await updateExecutionState(idempotencyConfig, eventId, { status: 'EXECUTING' });

  const statusUpdate = actionPlan.status_update!;

  try {
    // Find matching project
    const matchResult = await findMatchingProject(
      projectMatcherConfig,
      statusUpdate.project_reference
    );

    log('info', 'Project match result for status update', {
      event_id: eventId,
      searched_count: matchResult.searchedCount,
      best_match: matchResult.bestMatch?.sbId,
      best_confidence: matchResult.bestMatch?.confidence,
    });

    // Check if we have a confident match (>= 0.7 for auto-update)
    if (!matchResult.bestMatch || matchResult.bestMatch.confidence < projectMatcherConfig.autoLinkConfidence) {
      // No confident match found
      const errorMessage = matchResult.bestMatch
        ? `Found "${matchResult.bestMatch.title}" but confidence too low (${(matchResult.bestMatch.confidence * 100).toFixed(0)}%). Please be more specific.`
        : `Could not find a project matching "${statusUpdate.project_reference}"`;

      await sendSlackReply(
        { botTokenParam: BOT_TOKEN_PARAM },
        {
          channel: slackContext.channel_id,
          text: formatErrorReply(errorMessage),
          thread_ts: slackContext.thread_ts,
        }
      );

      await markFailed(idempotencyConfig, eventId, errorMessage);
      return;
    }

    // Update the project status
    const updateResult = await updateProjectStatus(
      knowledgeConfig,
      matchResult.bestMatch.path,
      statusUpdate.target_status,
      matchResult.bestMatch.title
    );

    if (!updateResult.success) {
      await sendSlackReply(
        { botTokenParam: BOT_TOKEN_PARAM },
        {
          channel: slackContext.channel_id,
          text: formatErrorReply(updateResult.error || 'Failed to update project status'),
          thread_ts: slackContext.thread_ts,
        }
      );

      await markFailed(idempotencyConfig, eventId, updateResult.error || 'Status update failed');
      return;
    }

    // Send confirmation - different message if status was already set
    const alreadySet = updateResult.previousStatus === updateResult.newStatus;
    const confirmationText = alreadySet
      ? `${matchResult.bestMatch.title} (${matchResult.bestMatch.sbId}) is already ${statusUpdate.target_status}`
      : `Updated ${matchResult.bestMatch.title} (${matchResult.bestMatch.sbId}) status to ${statusUpdate.target_status}`;

    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: slackContext.channel_id,
        text: confirmationText,
        thread_ts: slackContext.thread_ts,
      }
    );

    // Create receipt for status update
    const receipt = createReceipt(
      eventId,
      slackContext,
      'status_update' as Classification, // Extended classification
      actionPlan.intent_confidence,
      [
        { type: 'commit', status: 'success', details: { commitId: updateResult.commitId } },
        { type: 'slack_reply', status: 'success', details: { type: 'status_confirmation' } },
      ],
      [matchResult.bestMatch.path],
      updateResult.commitId || null,
      confirmationText,
      {
        projectSbId: matchResult.bestMatch.sbId,
        previousStatus: updateResult.previousStatus,
        newStatus: updateResult.newStatus,
      }
    );

    await appendReceipt(knowledgeConfig, receipt);
    await markCompleted(idempotencyConfig, eventId, updateResult.commitId);

    log('info', 'Status update completed', {
      event_id: eventId,
      project_sb_id: matchResult.bestMatch.sbId,
      previous_status: updateResult.previousStatus,
      new_status: updateResult.newStatus,
      commit_id: updateResult.commitId,
    });

  } catch (error) {
    log('error', 'Status update failed', {
      event_id: eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    await sendSlackReply(
      { botTokenParam: BOT_TOKEN_PARAM },
      {
        channel: slackContext.channel_id,
        text: formatErrorReply('Failed to update project status. Please try again.'),
        thread_ts: slackContext.thread_ts,
      }
    );

    await markFailed(idempotencyConfig, eventId, error instanceof Error ? error.message : 'Status update failed');
    throw error;
  }
}

/**
 * Execute action plan and finalize
 */
async function executeAndFinalize(
  eventId: string,
  slackContext: SlackContext,
  actionPlan: ActionPlan,
  systemPrompt: { content: string; metadata: { commitId: string; sha256: string } }
): Promise<void> {
  await updateExecutionState(idempotencyConfig, eventId, { status: 'EXECUTING' });

  // Task-project linking: Check for project reference in task classification
  if (actionPlan.classification === 'task' && actionPlan.project_reference) {
    log('info', 'Task has project reference, searching for match', {
      event_id: eventId,
      project_reference: actionPlan.project_reference,
    });

    try {
      const matchResult = await findMatchingProject(
        projectMatcherConfig,
        actionPlan.project_reference
      );

      log('info', 'Project match result', {
        event_id: eventId,
        searched_count: matchResult.searchedCount,
        best_match: matchResult.bestMatch?.sbId,
        best_confidence: matchResult.bestMatch?.confidence,
        candidates_count: matchResult.candidates.length,
      });

      if (matchResult.bestMatch && matchResult.bestMatch.confidence >= projectMatcherConfig.autoLinkConfidence) {
        // Auto-link: single clear match
        actionPlan.linked_project = {
          sb_id: matchResult.bestMatch.sbId,
          title: matchResult.bestMatch.title,
          confidence: matchResult.bestMatch.confidence,
        };
      } else if (matchResult.candidates.length > 1) {
        // Multiple candidates: store for potential clarification (future enhancement)
        // For now, just use the best candidate if above min threshold
        if (matchResult.candidates[0] && matchResult.candidates[0].confidence >= projectMatcherConfig.minConfidence) {
          actionPlan.linked_project = {
            sb_id: matchResult.candidates[0].sbId,
            title: matchResult.candidates[0].title,
            confidence: matchResult.candidates[0].confidence,
          };
        }
      }
    } catch (error) {
      // Log but don't fail - project linking is optional
      log('warn', 'Project matching failed', {
        event_id: eventId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Build executor config
  const executorConfig: ExecutorConfig = {
    knowledgeStore: knowledgeConfig,
    idempotency: idempotencyConfig,
    sesRegion: AWS_REGION,
    slackBotTokenParam: BOT_TOKEN_PARAM,
    mailDropParam: MAILDROP_PARAM,
    emailMode: EMAIL_MODE === 'log-only' ? 'log' : 'live',
    senderEmail: SES_FROM_EMAIL,
  };

  // Execute the action plan
  const result = await executeActionPlan(
    executorConfig,
    eventId,
    actionPlan,
    slackContext,
    { commitId: systemPrompt.metadata.commitId, sha256: systemPrompt.metadata.sha256, loadedAt: new Date().toISOString() }
  );

  // Task logging: If task was linked to a project, log it in the project file
  if (result.success && actionPlan.classification === 'task' && actionPlan.linked_project) {
    try {
      const taskTitle = actionPlan.task_details?.title || actionPlan.title || 'Untitled task';
      const today = new Date().toISOString().split('T')[0];
      
      // Find the project path from the match
      const matchResult = await findMatchingProject(
        projectMatcherConfig,
        actionPlan.linked_project.title
      );
      
      if (matchResult.bestMatch) {
        const logResult = await appendTaskLog(
          knowledgeConfig,
          matchResult.bestMatch.path,
          { date: today, title: taskTitle }
        );
        
        if (logResult.success) {
          log('info', 'Task logged to project', {
            event_id: eventId,
            project_sb_id: actionPlan.linked_project.sb_id,
            task_title: taskTitle,
            commit_id: logResult.commitId,
          });
        } else {
          log('warn', 'Failed to log task to project', {
            event_id: eventId,
            project_sb_id: actionPlan.linked_project.sb_id,
            error: logResult.error,
          });
        }
      }
    } catch (error) {
      // Log but don't fail - task logging is supplementary
      log('warn', 'Task logging failed', {
        event_id: eventId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  if (result.success) {
    await markCompleted(idempotencyConfig, eventId, result.commitId, result.receiptCommitId);
    log('info', 'Processing completed', {
      event_id: eventId,
      classification: actionPlan.classification,
      commit_id: result.commitId,
      linked_project: actionPlan.linked_project?.sb_id,
    });
  } else {
    log('warn', 'Execution failed', {
      event_id: eventId,
      error: result.error,
    });
  }
}

/**
 * Lambda handler for SQS events
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  log('info', 'Worker received event', {
    recordCount: event.Records.length,
  });

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as SQSEventMessage;
      await processMessage(message);
    } catch (error) {
      log('error', 'Failed to process message', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      batchItemFailures.push({
        itemIdentifier: record.messageId,
      });
    }
  }

  return { batchItemFailures };
}
