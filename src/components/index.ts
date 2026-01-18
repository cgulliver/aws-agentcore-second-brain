/**
 * Components Index
 * 
 * Re-exports all component modules for easy importing.
 */

// Idempotency Guard
export {
  tryAcquireLock,
  updateExecutionState,
  markCompleted,
  markFailed,
  markPartialFailure,
  isProcessed,
  getExecutionState,
  getCompletedSteps,
  canRetry,
  type ExecutionStatus,
  type StepStatus,
  type ExecutionState,
  type CompletedSteps,
  type IdempotencyConfig,
} from './idempotency-guard';

// Knowledge Store
export {
  getLatestCommitId,
  readFile,
  writeFile,
  appendToFile,
  generateFilePath,
  generateSlug,
  createKnowledgeFile,
  type KnowledgeStoreConfig,
  type CommitResult,
  type FileContent,
} from './knowledge-store';

// Receipt Logger
export {
  createReceipt,
  serializeReceipt,
  parseReceipt,
  appendReceipt,
  findReceiptByEventId,
  findMostRecentReceipt,
  getAllReceipts,
  type Receipt,
  type ReceiptAction,
  type SlackContext,
} from './receipt-logger';

// System Prompt Loader
export {
  loadSystemPrompt,
  computePromptHash,
  validatePromptStructure,
  clearPromptCache,
  getCachedPrompt,
  type SystemPromptConfig,
  type SystemPromptMetadata,
  type SystemPrompt,
  type PromptValidationResult,
} from './system-prompt-loader';

// Action Plan
export {
  validateActionPlan,
  parseActionPlanFromLLM,
  createDefaultActionPlan,
  requiresClarification,
  hasHighConfidence,
  type ActionPlan,
  type FileOperation,
  type TaskDetails,
  type ValidationError,
  type ValidationResult,
} from './action-plan';

// Action Executor
export {
  executeActionPlan,
  type ExecutorConfig,
  type ExecutionResult,
} from './action-executor';

// AgentCore Client
export {
  invokeAgentRuntime,
  shouldAskClarification,
  generateClarificationPrompt,
  MockAgentCoreClient,
  CONFIDENCE_THRESHOLDS,
  type AgentCoreConfig,
  type InvocationPayload,
  type InvocationResult,
} from './agentcore-client';

// Task Router
export {
  formatTaskEmail,
  sendTaskEmail,
  clearMailDropCache,
  type TaskEmail,
  type TaskRouterConfig,
  type TaskSendResult,
  type SlackSource,
} from './task-router';

// Slack Responder
export {
  formatConfirmationReply,
  formatClarificationReply,
  formatErrorReply,
  sendSlackReply,
  clearBotTokenCache,
  type SlackReply,
  type SlackResponderConfig,
  type SlackSendResult,
} from './slack-responder';

// Conversation Context
export {
  generateSessionId,
  parseSessionId,
  getContext,
  setContext,
  updateContextWithResponse,
  deleteContext,
  hasActiveContext,
  clearTTLCache,
  getCachedTTL,
  type ConversationContext,
  type ConversationStoreConfig,
} from './conversation-context';

// Fix Handler
export {
  parseFixCommand,
  isFixCommand,
  getFixableReceipt,
  applyFix,
  canApplyFix,
  type FixCommand,
  type FixResult,
} from './fix-handler';

// Markdown Templates
export {
  formatISODate,
  formatISOTime,
  sanitizeForMarkdown,
  generateInboxEntry,
  generateInboxHeader,
  generateIdeaNote,
  generateDecisionNote,
  generateProjectPage,
  generateContent,
  type TemplateOptions,
  type InboxEntry,
  type IdeaNote,
  type DecisionNote,
  type ProjectPage,
} from './markdown-templates';
