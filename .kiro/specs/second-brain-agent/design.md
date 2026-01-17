# Design Document: Second Brain Agent

## Overview

The Second Brain Agent is a serverless system that provides a DM-only Slack interface for personal knowledge capture, classification, and routing. The system uses Amazon Bedrock AgentCore for intelligent classification and planning, AWS CodeCommit for durable Markdown storage, and AWS SES for routing tasks to OmniFocus via Mail Drop.

### Agent Platform Decision

The system uses **Bedrock AgentCore** as the agent implementation.

**Explicit Non-Usage** — The system does NOT use:
- Bedrock Agents (`CfnAgent`, `CreateAgent`, `PrepareAgent`)
- `InvokeAgentCommand`
- Bedrock Agent Action Groups

**Canonical Invocation Path:**
```
Slack → Lambda Function URL → Lambda → Bedrock AgentCore Runtime → Lambda → Slack
```

AgentCore is a hosted agent runtime, not a Bedrock Agent invocation surface.

### Agent Execution Model

The system uses a **AgentCore + Lambda Orchestrator** pattern:

| Component | Responsibility | Does NOT |
|-----------|----------------|----------|
| **AgentCore Runtime** | Classification, reasoning, Action Plan generation | Execute side effects, hold credentials |
| **Lambda Orchestrator** | Invoke AgentCore, validate Action Plan, execute all side effects | Classification, content generation |

**Explicit Non-Goals (v1):**
- Bedrock Agent Action Groups are NOT used
- AgentCore does NOT execute side effects directly
- Agent does NOT call CodeCommit, SES, or Slack directly

### Key Design Principles

1. **Simplicity**: Minimal infrastructure with clear separation of concerns
2. **Durability**: Git-based storage with append-only audit trail
3. **Idempotency**: Exactly-once semantics despite at-least-once delivery
4. **Trust**: Cryptographic verification and least-privilege access
5. **Auditability**: Every action produces a receipt

### High-Level Flow

```
User DM → Slack Events API → Lambda Function URL → Ingress Lambda → SQS Queue
                                                                        ↓
                                                                  Worker Lambda
                                                                        ↓
                                    ┌───────────────────────────────────┼───────────────────────────────────┐
                                    ↓                                   ↓                                   ↓
                            Bedrock AgentCore                    CodeCommit                              SES
                            (Classification)                     (Knowledge)                           (Tasks)
                                    ↓                                   ↓                                   ↓
                                    └───────────────────────────────────┼───────────────────────────────────┘
                                                                        ↓
                                                                  Slack Reply
```

### Detailed Sequence Diagram

```
┌──────┐     ┌───────────┐     ┌─────────┐     ┌─────┐     ┌────────┐     ┌──────────┐     ┌──────────┐     ┌─────┐     ┌───────────┐
│ User │     │   Slack   │     │ Ingress │     │ SQS │     │ Worker │     │ DynamoDB │     │ Bedrock  │     │ Git │     │ Slack API │
│      │     │ Events API│     │ Lambda  │     │     │     │ Lambda │     │          │     │  Agent   │     │     │     │           │
└──┬───┘     └─────┬─────┘     └────┬────┘     └──┬──┘     └───┬────┘     └────┬─────┘     └────┬─────┘     └──┬──┘     └─────┬─────┘
   │               │                │             │            │               │                │              │              │
   │  DM message   │                │             │            │               │                │              │              │
   │──────────────▶│                │             │            │               │                │              │              │
   │               │                │             │            │               │                │              │              │
   │               │ POST webhook   │             │            │               │                │              │              │
   │               │───────────────▶│             │            │               │                │              │              │
   │               │                │             │            │               │                │              │              │
   │               │                │ Verify sig  │            │               │                │              │              │
   │               │                │ + timestamp │            │               │                │              │              │
   │               │                │             │            │               │                │              │              │
   │               │   HTTP 200     │             │            │               │                │              │              │
   │               │◀───────────────│             │            │               │                │              │              │
   │               │                │             │            │               │                │              │              │
   │               │                │ SendMessage │            │               │                │              │              │
   │               │                │────────────▶│            │               │                │              │              │
   │               │                │             │            │               │                │              │              │
   │               │                │             │  Trigger   │               │                │              │              │
   │               │                │             │───────────▶│               │                │              │              │
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │ PutItem       │                │              │              │
   │               │                │             │            │ (conditional) │                │              │              │
   │               │                │             │            │──────────────▶│                │              │              │
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │   Success     │                │              │              │
   │               │                │             │            │◀──────────────│                │              │              │
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │ InvokeAgent   │                │              │              │
   │               │                │             │            │ (classify)    │                │              │              │
   │               │                │             │            │──────────────────────────────▶│              │              │
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │               │   Action Plan  │              │              │
   │               │                │             │            │◀──────────────────────────────│              │              │
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │ CreateCommit  │                │              │              │
   │               │                │             │            │───────────────────────────────────────────▶│              │
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │   commit_id   │                │              │              │
   │               │                │             │            │◀──────────────────────────────────────────│              │
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │ chat.postMessage               │              │              │
   │               │                │             │            │─────────────────────────────────────────────────────────▶│
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │   reply_ts    │                │              │              │
   │               │                │             │            │◀─────────────────────────────────────────────────────────│
   │               │                │             │            │               │                │              │              │
   │               │                │             │            │ AppendReceipt │                │              │              │
   │               │                │             │            │───────────────────────────────────────────▶│              │
   │               │                │             │            │               │                │              │              │
   │  Slack reply  │                │             │            │               │                │              │              │
   │◀──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
   │               │                │             │            │               │                │              │              │
```

### Separation of Concerns Summary

| Layer | Component | Responsibilities | Does NOT |
|-------|-----------|------------------|----------|
| **Infrastructure** | Ingress Lambda | Signature verification, ACK, enqueue | Process messages, call Bedrock |
| **Infrastructure** | Worker Lambda | Idempotency, invoke AgentCore, execute side effects, Slack I/O | Classification, content generation |
| **Agent Logic** | AgentCore Runtime | Classification, Action Plan generation | Side effects, credentials |
| **Storage** | CodeCommit | Durable knowledge, receipts, system prompt | Idempotency, preferences |
| **Storage** | DynamoDB | Idempotency, conversation context | Knowledge storage |
| **Storage** | AgentCore Memory | Behavioral preferences (advisory) | Durable knowledge, receipts |

## Architecture

### Component Architecture

The system follows a two-tier Lambda architecture with clear separation between ingress (fast acknowledgement) and worker (async processing). Uses Lambda Function URLs instead of API Gateway for simplicity.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS Cloud                                       │
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Slack     │───▶│  Lambda     │───▶│  Ingress    │───▶│    SQS      │  │
│  │  Events API │    │ Function URL│    │   Lambda    │    │   Queue     │  │
│  └─────────────┘    │ (Auth=NONE) │    └─────────────┘    └──────┬──────┘  │
│                     └─────────────┘                              │         │
│                                                                  ▼         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Slack     │◀───│    SES      │    │ CodeCommit  │◀───│   Worker    │  │
│  │   Web API   │    │  (Email)    │    │   (Git)     │    │   Lambda    │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘  │
│        ▲                  ▲                                      │         │
│        │                  │            ┌─────────────┐           │         │
│        └──────────────────┴────────────│  Bedrock    │◀──────────┘         │
│                                        │  AgentCore  │                      │
│                                        └─────────────┘                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         DynamoDB (Idempotency)                       │   │
│  │  • Table: second-brain-idempotency                                  │   │
│  │  • Key: event_id (String)                                           │   │
│  │  • TTL: expires_at                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SSM Parameter Store (SecureString)                │   │
│  │  • /second-brain/slack-signing-secret                               │   │
│  │  • /second-brain/slack-bot-token                                    │   │
│  │  • /second-brain/omnifocus-maildrop-email                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Ingress Lambda

Responsibilities:
- Verify Slack signing signature
- Validate request timestamp (replay protection)
- Handle URL verification challenge
- Filter non-DM events
- Enqueue valid events to SQS
- Return HTTP 200 within 3 seconds

### Worker Lambda

> **Key Principle: AgentCore returns Action Plan only; Lambda executes all side effects.**
>
> AgentCore Runtime performs classification and reasoning.
> Lambda validates the Action Plan and executes all side effects (CodeCommit, SES, Slack).
> This separation ensures testability, idempotency, and credential isolation.

**Worker Lambda Responsibilities (Orchestrator):**
- Receive events from SQS
- Check idempotency (DynamoDB conditional write on `event_id`)
- Load system prompt from CodeCommit (with fallback if missing)
- Invoke AgentCore Runtime
- Validate Action Plan JSON against schema
- Execute side effects in order: CodeCommit → SES → Slack
- Write receipt to CodeCommit
- Format and deliver response to Slack (Web API)
- Hold all credentials (Slack bot token, SES sender)

**AgentCore Runtime Responsibilities (Reasoning Only):**
- Classification (inbox/idea/decision/project/task)
- Confidence scoring
- Action Plan JSON generation
- Reasoning and explanation

**AgentCore does NOT:**
- Execute CodeCommit writes
- Send SES emails
- Call Slack APIs
- Hold any credentials
- Perform any side effects

### AgentCore Runtime Architecture (Containerized)

The AgentCore Runtime is a **containerized Python agent service** deployed via `CfnRuntime`. It is NOT a direct SDK call from Lambda.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AgentCore Runtime Deployment                              │
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   agent/    │───▶│  CodeBuild  │───▶│    ECR      │───▶│  CfnRuntime │  │
│  │ Python code │    │ (ARM64 img) │    │ (container) │    │ (AgentCore) │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                             │
│  Lambda invokes AgentCore Runtime via boto3:                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  agentcore = boto3.client('bedrock-agentcore')                      │   │
│  │  response = agentcore.invoke_agent_runtime(                         │   │
│  │      agentRuntimeArn=AGENT_RUNTIME_ARN,                             │   │
│  │      qualifier="DEFAULT",                                           │   │
│  │      payload=json.dumps({                                           │   │
│  │          "prompt": f"{system_prompt}\n\n{user_message}"             │   │
│  │      })                                                             │   │
│  │  )                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Container Components:**
- `agent/classifier.py` — Python agent using `BedrockAgentCoreApp` + Strands Agents
- `agent/Dockerfile` — ARM64 container image
- `agent/requirements.txt` — Dependencies: `strands-agents`, `bedrock-agentcore`

**CDK Resources:**
- `CfnRuntime` — AgentCore Runtime pointing to ECR container
- ECR Repository — Stores classifier container image
- CodeBuild Project — Builds ARM64 Docker image
- Build Trigger Custom Resource — Triggers build on first deploy

**Agent Entry Point Pattern:**
```python
from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@app.entrypoint
async def invoke(payload=None):
    prompt = payload.get("prompt", "")
    agent = Agent(system_prompt="")  # System prompt passed in payload
    response = agent(prompt)
    return {
        "classification": ...,
        "confidence": ...,
        "file_operations": [...],
        ...
    }

if __name__ == "__main__":
    app.run()
```

### Idempotency Strategy

The system uses DynamoDB for exactly-once side effect guarantees:

1. **DynamoDB conditional writes**: Before processing, attempt to write `event_id` to DynamoDB with a condition that it doesn't exist
2. **TTL-based expiration**: Records expire after 7 days to prevent unbounded growth
3. **Optimistic locking**: CodeCommit commits include parent commit reference to prevent overwrites

```
┌─────────────────────────────────────────────────────────────────┐
│                    Idempotency Flow                              │
│                                                                  │
│  Event arrives → DynamoDB conditional put (event_id)            │
│       │                                                          │
│       ├─ ConditionalCheckFailed → Return success (duplicate)    │
│       │                                                          │
│       └─ Success → Process event                                │
│              │                                                   │
│              ├─ Classify message                                │
│              ├─ Perform action (commit/email)                   │
│              ├─ Write receipt (atomic)                          │
│              └─ Reply to Slack                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. SlackIngress Component

```typescript
interface SlackIngressConfig {
  signingSecret: string;        // From SSM
  sqsQueueUrl: string;          // SQS queue for events
  timestampToleranceSec: number; // Default: 300 (5 minutes)
}

interface SlackEvent {
  type: 'url_verification' | 'event_callback';
  challenge?: string;           // For url_verification
  event?: {
    type: string;
    channel_type?: string;
    user?: string;
    bot_id?: string;
    subtype?: string;
    text?: string;
    ts?: string;
    channel?: string;
  };
  event_id?: string;
  event_time?: number;
}

interface SlackIngressResult {
  statusCode: number;
  body: string;
}

// Functions
function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean;

function isValidTimestamp(timestamp: number, toleranceSec: number): boolean;

function shouldProcessEvent(event: SlackEvent): boolean;

function handleSlackRequest(
  config: SlackIngressConfig,
  request: APIGatewayProxyEvent
): Promise<SlackIngressResult>;
```

### 2. Classifier Component

> **Platform:** Bedrock AgentCore Runtime (NOT Bedrock Agents)
> AgentCore returns Action Plan JSON only; Lambda executes side effects.

#### Agent Instructions vs System Prompt

| Aspect | Agent Instructions | System Prompt |
|--------|-------------------|---------------|
| **Location** | AgentCore configuration | CodeCommit `/system/agent-system-prompt.md` |
| **Content** | Safety constraints, output contract, role | Classification rules, templates, taxonomy |
| **Mutability** | Rarely changed | Versioned, auditable, frequently tuned |
| **Deployment** | AgentCore setup | Git commit |

**System Prompt (Dynamic)** — loaded from CodeCommit at runtime:
- Classification rules and signals
- Confidence thresholds
- Markdown templates
- Taxonomy definitions

**Runtime Guard:** If system prompt is missing, fall back to minimal safe prompt and emit error logs.

```typescript
type Classification = 'inbox' | 'idea' | 'decision' | 'project' | 'task';

interface ClassificationResult {
  classification: Classification;
  confidence: number;           // 0.0 to 1.0
  reasoning: string;            // LLM explanation
  suggestedSlug?: string;       // For idea/decision/project
  suggestedTitle?: string;      // For task
}

interface ClassifierConfig {
  agentId: string;              // Bedrock Agent ID
  agentAliasId: string;         // Agent Alias ID (use TSTALIASID for draft)
  lowConfidenceThreshold: number;   // Default: 0.7
  highConfidenceThreshold: number;  // Default: 0.85
}

// Functions
function classifyMessage(
  config: ClassifierConfig,
  messageText: string,
  conversationContext?: ConversationContext
): Promise<ClassificationResult>;

function shouldAskClarification(result: ClassificationResult, config: ClassifierConfig): boolean;

function generateClarificationPrompt(result: ClassificationResult): string;
```

### 3. KnowledgeStore Component

```typescript
interface KnowledgeStoreConfig {
  repositoryName: string;
  branchName: string;           // Default: 'main'
}

interface CommitResult {
  commitId: string;
  filePath: string;
  parentCommitId: string | null;
}

interface FileContent {
  path: string;
  content: string;
  mode: 'create' | 'append' | 'update';
}

// Functions
function getLatestCommitId(config: KnowledgeStoreConfig): Promise<string | null>;

function readFile(
  config: KnowledgeStoreConfig,
  filePath: string
): Promise<string | null>;

function writeFile(
  config: KnowledgeStoreConfig,
  file: FileContent,
  commitMessage: string,
  parentCommitId: string | null
): Promise<CommitResult>;

function appendToFile(
  config: KnowledgeStoreConfig,
  filePath: string,
  content: string,
  commitMessage: string
): Promise<CommitResult>;

function generateFilePath(
  classification: Classification,
  slug?: string,
  date?: Date
): string;

function generateSlug(text: string): string;
```

### 4. ReceiptLogger Component

```typescript
interface Receipt {
  timestamp_iso: string;
  event_id: string;
  slack: {
    user_id: string;
    channel_id: string;
    message_ts: string;
  };
  classification: Classification | 'fix' | 'clarify';
  confidence: number;
  actions: ReceiptAction[];
  files: string[];
  commit_id: string | null;
  prior_commit_id: string | null;
  summary: string;
}

interface ReceiptAction {
  type: 'commit' | 'email' | 'slack_reply';
  details: Record<string, unknown>;
}

// Functions
function createReceipt(
  eventId: string,
  slackContext: SlackContext,
  classification: Classification | 'fix' | 'clarify',
  confidence: number,
  actions: ReceiptAction[],
  files: string[],
  commitId: string | null,
  summary: string
): Receipt;

function appendReceipt(
  config: KnowledgeStoreConfig,
  receipt: Receipt
): Promise<CommitResult>;

function findReceiptByEventId(
  config: KnowledgeStoreConfig,
  eventId: string
): Promise<Receipt | null>;

function serializeReceipt(receipt: Receipt): string;

function parseReceipt(line: string): Receipt;
```

### 5. TaskRouter Component

```typescript
interface TaskRouterConfig {
  sesRegion: string;
  fromEmail: string;            // Verified SES sender
  omniFocusMailDrop: string;    // From SSM
}

interface TaskEmail {
  subject: string;              // Task title
  body: string;                 // Context + source
}

interface TaskSendResult {
  messageId: string;
  success: boolean;
}

// Functions
function formatTaskEmail(
  taskTitle: string,
  context: string,
  slackSource: SlackContext
): TaskEmail;

function sendTaskEmail(
  config: TaskRouterConfig,
  email: TaskEmail
): Promise<TaskSendResult>;
```

### 6. SlackResponder Component

```typescript
interface SlackResponderConfig {
  botToken: string;             // From SSM
}

interface SlackReply {
  channel: string;
  text: string;
  thread_ts?: string;
}

// Functions
function formatConfirmationReply(
  classification: Classification,
  files: string[],
  commitId: string | null
): string;

function formatClarificationReply(
  question: string,
  options: string[]
): string;

function sendSlackReply(
  config: SlackResponderConfig,
  reply: SlackReply
): Promise<void>;
```

#### Slack Response Patterns

The system uses different Slack response patterns depending on the context:

| Scenario | Response Type | Method | Behavior |
|----------|---------------|--------|----------|
| **Successful capture** | Threaded reply | `chat.postMessage` with `thread_ts` | Reply in thread to original message |
| **Clarification needed** | Threaded reply | `chat.postMessage` with `thread_ts` | Reply in thread, await user response |
| **Validation error** | Threaded reply | `chat.postMessage` with `thread_ts` | Error message in thread |
| **Fix confirmation** | Threaded reply | `chat.postMessage` with `thread_ts` | Confirm fix applied in thread |

**Why Threaded Replies (not ephemeral or modal):**
- **Threaded**: Creates a conversation history the user can reference
- **Not ephemeral**: User needs persistent confirmation of what was captured
- **Not modal**: DM context doesn't support modals; threaded replies are simpler

**Response Format Examples:**

```
# Successful capture (inbox)
Captured as *inbox*
Files: 00-inbox/2026-01-17.md
Commit: `a1b2c3d`

Reply `fix: <instruction>` to correct.

# Successful capture (idea)
Captured as *idea*
Files: 10-ideas/migration-debt.md
Commit: `d4e5f6g`

Reply `fix: <instruction>` to correct.

# Successful capture (task)
Captured as *task*
Task sent to OmniFocus: "Review Q1 budget"

Reply `fix: <instruction>` to correct.

# Clarification needed
I'm not sure how to classify this. Is it:
• *idea* — a conceptual insight or observation
• *decision* — a commitment you've made
• *task* — something you need to do

Or reply `reclassify: <type>` to specify directly.

# Validation error
I couldn't process that message. Please try rephrasing.

Error: Invalid classification in Action Plan
```

### 7. ConversationContext Component

```typescript
interface ConversationContext {
  originalEventId: string;
  originalMessage: string;
  clarificationAsked: string;
  clarificationResponse?: string;
  expiresAt: number;            // Unix timestamp
}

interface ConversationStore {
  // DynamoDB table for conversation context
  get(channelId: string, userId: string): Promise<ConversationContext | null>;
  set(channelId: string, userId: string, context: ConversationContext): Promise<void>;
  delete(channelId: string, userId: string): Promise<void>;
}
```

### 7a. IdempotencyGuard Component

```typescript
interface IdempotencyConfig {
  tableName: string;            // DynamoDB table name
  ttlDays: number;              // Default: 7
}

interface IdempotencyRecord {
  event_id: string;             // Partition key
  processed_at: string;         // ISO timestamp
  expires_at: number;           // TTL (Unix timestamp)
  status: 'processing' | 'completed' | 'failed';
  result_summary?: string;
}

// Functions
function tryAcquireLock(
  config: IdempotencyConfig,
  eventId: string
): Promise<boolean>;  // Returns true if lock acquired, false if duplicate

function markCompleted(
  config: IdempotencyConfig,
  eventId: string,
  summary: string
): Promise<void>;

function markFailed(
  config: IdempotencyConfig,
  eventId: string,
  error: string
): Promise<void>;

function isProcessed(
  config: IdempotencyConfig,
  eventId: string
): Promise<boolean>;
```

### 8. FixHandler Component

```typescript
interface FixRequest {
  instruction: string;
  priorReceiptEventId?: string;
}

interface FixResult {
  success: boolean;
  newCommitId?: string;
  priorCommitId?: string;
  summary: string;
}

// Functions
function parseFixCommand(messageText: string): FixRequest | null;

function findMostRecentReceipt(
  config: KnowledgeStoreConfig,
  userId: string
): Promise<Receipt | null>;

function applyFix(
  config: KnowledgeStoreConfig,
  priorReceipt: Receipt,
  instruction: string
): Promise<FixResult>;
```

### 9. SystemPromptLoader Component

```typescript
interface SystemPromptConfig {
  repositoryName: string;
  branchName: string;           // Default: 'main'
  promptPath: string;           // Default: '/system/agent-system-prompt.md'
}

interface SystemPromptMetadata {
  commitId: string;             // Commit id where prompt was read
  sha256: string;               // SHA-256 hash of prompt content
  loadedAt: string;             // ISO timestamp
}

interface SystemPrompt {
  content: string;              // Full Markdown content
  metadata: SystemPromptMetadata;
}

// Functions
function loadSystemPrompt(
  config: SystemPromptConfig
): Promise<SystemPrompt>;

function computePromptHash(content: string): string;

function validatePromptStructure(content: string): boolean;
```

### 10. ActionPlan Component

```typescript
type FileOperationType = 'create' | 'append' | 'update';

interface FileOperation {
  path: string;
  operation: FileOperationType;
  content: string;
}

interface OmniFocusEmail {
  subject: string;
  body: string;
}

interface ActionPlan {
  classification: Classification;
  confidence: number;
  needs_clarification: boolean;
  clarification_prompt?: string;
  file_operations: FileOperation[];
  commit_message: string;
  omnifocus_email?: OmniFocusEmail;
  slack_reply_text: string;
}

interface ActionPlanValidationResult {
  valid: boolean;
  errors: string[];
}

// Functions
function validateActionPlan(plan: unknown): ActionPlanValidationResult;

function parseActionPlanFromLLM(llmOutput: string): ActionPlan | null;
```

### 11. ActionPlanExecutor Component

```typescript
interface ExecutionContext {
  eventId: string;
  slackContext: SlackContext;
  promptMetadata: SystemPromptMetadata;
}

interface ExecutionResult {
  success: boolean;
  commitId?: string;
  emailMessageId?: string;
  slackReplyTs?: string;
  failedStep?: 'commit' | 'email' | 'slack';
  error?: string;
}

// Functions
function executeActionPlan(
  plan: ActionPlan,
  context: ExecutionContext,
  knowledgeStore: KnowledgeStoreConfig,
  taskRouter: TaskRouterConfig,
  slackResponder: SlackResponderConfig
): Promise<ExecutionResult>;

// Side effect ordering: commit → email → slack
// If any step fails, subsequent steps are skipped
```

## Data Models

### Slack Event Payload

```typescript
interface SlackEventPayload {
  token: string;
  team_id: string;
  api_app_id: string;
  event: {
    type: string;               // 'message'
    channel: string;            // DM channel ID
    channel_type: string;       // 'im' for DMs
    user: string;               // User ID
    text: string;               // Message content
    ts: string;                 // Message timestamp
    event_ts: string;           // Event timestamp
    bot_id?: string;            // Present if from bot
    subtype?: string;           // Present for edits/deletes
  };
  type: string;                 // 'event_callback'
  event_id: string;             // Unique event ID
  event_time: number;           // Unix timestamp
  authorizations: Array<{
    enterprise_id: string | null;
    team_id: string;
    user_id: string;
    is_bot: boolean;
  }>;
}
```

### SQS Message Format

```typescript
interface SQSEventMessage {
  eventId: string;
  eventTime: number;
  channelId: string;
  userId: string;
  messageTs: string;
  messageText: string;
  receivedAt: string;           // ISO timestamp
}
```

### Receipt Schema (JSONL)

```typescript
interface Receipt {
  timestamp_iso: string;        // "2026-01-17T19:25:10-05:00"
  event_id: string;             // "Ev0123456789"
  slack: {
    user_id: string;            // "U012ABCDEF"
    channel_id: string;         // "D012XYZ123"
    message_ts: string;         // "1737159910.123456"
  };
  classification: 'inbox' | 'idea' | 'decision' | 'project' | 'task' | 'fix' | 'clarify';
  confidence: number;           // 0.0 to 1.0
  actions: Array<{
    type: 'commit' | 'email' | 'slack_reply';
    details: {
      repo?: string;
      branch?: string;
      message?: string;
      provider?: string;
      to?: string;
      subject?: string;
      channel_id?: string;
      prompt?: string;
    };
  }>;
  files: string[];              // ["10-ideas/migration-debt.md"]
  commit_id: string | null;     // "a1b2c3d4e5f6"
  prior_commit_id: string | null;
  prompt_commit_id: string;     // Commit id of system prompt
  prompt_sha256: string;        // SHA-256 hash of system prompt content
  summary: string;              // Human-readable description
  validation_errors?: string[]; // Present if Action Plan validation failed
}
```

### Markdown Templates

#### Inbox Entry Format
```markdown
# Inbox — YYYY-MM-DD

## Captures
- HH:MM — <content> (likely: <classification>)
```

#### Idea Note Format
```markdown
# <Title>

## Context
<context>

## Key points
- <point 1>
- <point 2>

## Implications
- <implication>

## Open questions
- <question>

## Source
Slack DM — <channel_id> @ <message_ts>
```

#### Decision Note Format
```markdown
# Decision — <Title>

**Date:** YYYY-MM-DD

## Decision
<explicit decision statement>

## Rationale
- <reason 1>
- <reason 2>

## Alternatives considered
- <alternative 1> (rejected: <reason>)

## Consequences
- <consequence>

## Source
Slack DM — <channel_id> @ <message_ts>
```

#### Project Page Format
```markdown
# Project — <Title>

## Objective
<objective>

## Status
- Phase: <phase>
- <status details>

## Key decisions
- YYYY-MM-DD: <decision> (`20-decisions/YYYY-MM-DD-<slug>.md`)

## Next steps
- <step 1>
- <step 2>

## References
- <reference>
```

### CodeCommit Repository Structure

```
second-brain/
├── system/
│   └── agent-system-prompt.md  # Agent behavior definition (required)
├── 00-inbox/
│   └── YYYY-MM-DD.md           # Daily append-only captures
├── 10-ideas/
│   └── <slug>.md               # Atomic idea notes
├── 20-decisions/
│   └── YYYY-MM-DD-<slug>.md    # Dated decision records
├── 30-projects/
│   └── <project-slug>.md       # Project state pages
└── 90-receipts/
    └── receipts.jsonl          # Append-only audit log
```

### System Prompt Template

```markdown
# Second Brain Agent — System Prompt

## Role

You are a private, single-user Second Brain agent. You act as a chief-of-staff and knowledge architect. You are NOT a general chat assistant.

## Core Responsibilities

- Classify every input into exactly one category
- Decide whether to commit knowledge, create a task, ask a question, or take no action
- Produce durable, auditable artifacts
- Never perform irreversible side effects without sufficient confidence or explicit confirmation

## Hard Constraints (Non-Negotiable)

- Slack is the conversation layer only
- CodeCommit is the durable memory
- OmniFocus is the execution engine
- Inbox and receipts are append-only
- Git history must not be silently rewritten
- No destructive edits without confirmation
- One classification per message

## Classification Rules

Classify each message as exactly one of: `inbox | idea | decision | project | task`

| Signal | Classification |
|--------|---------------|
| Verbs + obligation (must, need to, should) | task |
| Insight, framing, or conceptual observation | idea |
| Explicit commitment language ("I've decided", "We will") | decision |
| Ongoing work with state tracking | project |
| Everything else | inbox |

## Confidence Bouncer

| Confidence Level | Threshold | Action |
|-----------------|-----------|--------|
| High | ≥ 0.85 | Proceed with side effects |
| Medium | 0.70 – 0.84 | Ask clarifying question OR default to inbox |
| Low | < 0.70 | Ask exactly one clarifying question, no side effects |

## Knowledge Architecture Rules

- `00-inbox/YYYY-MM-DD.md` — append-only daily captures
- `10-ideas/<slug>.md` — atomic idea notes
- `20-decisions/YYYY-MM-DD-<slug>.md` — dated decisions
- `30-projects/<project-slug>.md` — project state pages
- `90-receipts/receipts.jsonl` — append-only audit log

## GTD / OmniFocus Rules

- Tasks go to OmniFocus only (via email)
- Knowledge never goes into OmniFocus
- Tasks reference knowledge; they do not duplicate it

## Fix & Repair Protocol

- `fix:` instructions apply corrective changes
- Corrections produce new commits and receipts
- Receipts reference prior commit ids

## Output Contract

You MUST output a valid Action Plan JSON object:

\`\`\`json
{
  "classification": "inbox | idea | decision | project | task",
  "confidence": 0.0-1.0,
  "needs_clarification": true | false,
  "clarification_prompt": "string (if needs_clarification)",
  "file_operations": [
    {"path": "string", "operation": "create | append | update", "content": "string"}
  ],
  "commit_message": "string",
  "omnifocus_email": {"subject": "string", "body": "string"} | null,
  "slack_reply_text": "string"
}
\`\`\`

## Forbidden Behaviors

- No hallucinated files or paths
- No multi-classification
- No speculative commits
- No acting when confidence is low
- No deviation from folder taxonomy
```

### Configuration Parameters (SSM)

| Parameter Path | Type | Description |
|---------------|------|-------------|
| `/second-brain/slack-signing-secret` | SecureString | Slack app signing secret |
| `/second-brain/slack-bot-token` | SecureString | Slack bot OAuth token |
| `/second-brain/omnifocus-maildrop-email` | SecureString | OmniFocus Mail Drop address |
| `/second-brain/confidence-threshold-low` | String | Low confidence threshold (default: 0.7) |
| `/second-brain/confidence-threshold-high` | String | High confidence threshold (default: 0.85) |

### CDK Stack Structure

The infrastructure is organized into two CDK stacks for separation of concerns:

```typescript
// lib/ingress-stack.ts
interface IngressStackProps extends cdk.StackProps {
  environment: 'dev' | 'prod';
}

// Ingress Stack Resources:
// - Ingress Lambda Function
// - Lambda Function URL (Auth = NONE, public HTTPS endpoint)
// - SQS Queue (primary event queue)
// - SQS Dead Letter Queue (DLQ)
// - IAM Role (ingress-specific, least privilege)
// - SSM Parameter references (slack-signing-secret only)

// lib/core-stack.ts
interface CoreStackProps extends cdk.StackProps {
  environment: 'dev' | 'prod';
  ingressQueueArn: string;      // From Ingress Stack
}

// Core Stack Resources:
// - Worker Lambda Function
// - CodeCommit Repository
// - DynamoDB Table (idempotency, TTL enabled)
// - SES Email Identity
// - IAM Role (worker-specific, least privilege)
// - SSM Parameter references (bot-token, maildrop-email)
```

### DynamoDB Table Schema

```typescript
// Idempotency Table
{
  TableName: 'second-brain-idempotency',
  KeySchema: [
    { AttributeName: 'event_id', KeyType: 'HASH' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'event_id', AttributeType: 'S' }
  ],
  TimeToLiveSpecification: {
    AttributeName: 'expires_at',
    Enabled: true
  },
  BillingMode: 'PAY_PER_REQUEST'
}

// Conversation Context Table (optional, can share with idempotency)
{
  TableName: 'second-brain-conversations',
  KeySchema: [
    { AttributeName: 'pk', KeyType: 'HASH' }  // channel_id#user_id
  ],
  TimeToLiveSpecification: {
    AttributeName: 'expires_at',
    Enabled: true
  }
}
```

### Memory Strategy

The system uses two distinct memory layers with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Memory Architecture                                  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Git (CodeCommit) — Durable Knowledge              │   │
│  │  • Inbox captures (append-only)                                     │   │
│  │  • Ideas, Decisions, Projects (atomic notes)                        │   │
│  │  • Receipts (append-only audit log)                                 │   │
│  │  • System prompt                                                    │   │
│  │  ✓ Source of truth                                                  │   │
│  │  ✓ Versioned, auditable, diffable                                   │   │
│  │  ✓ Durable across tools and time                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                AgentCore Memory — Behavioral Context                 │   │
│  │  • User preferences (confidence thresholds, taxonomy words)         │   │
│  │  • Stable operating assumptions ("tasks go to OmniFocus")           │   │
│  │  • Short-lived clarification state (TTL-like)                       │   │
│  │  ✗ NOT for durable notes or receipts                                │   │
│  │  ✗ NOT for idempotency keys                                         │   │
│  │  ✗ NOT for anything requiring exact reconstruction                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Golden Rule: If Git and AgentCore Memory conflict, Git wins.              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### AgentCore Memory Usage (v1)

| Category | Example | Store in AgentCore Memory? |
|----------|---------|---------------------------|
| User preferences | "confidence threshold = 0.85" | ✓ Yes |
| Operating assumptions | "tasks go to OmniFocus" | ✓ Yes |
| Clarification state | "awaiting classification response" | ✓ Yes (short-lived) |
| Full notes | idea content, decision rationale | ✗ No (Git only) |
| Receipts | audit log entries | ✗ No (Git only) |
| Idempotency keys | event_id tracking | ✗ No (DynamoDB only) |


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Signature Verification

*For any* Slack request with a body, timestamp, and signature, the `verifySlackSignature` function SHALL return `true` if and only if the signature matches the HMAC-SHA256 of `v0:{timestamp}:{body}` using the signing secret.

**Validates: Requirements 1.1, 1.3**

### Property 2: Timestamp Validation

*For any* timestamp value, the `isValidTimestamp` function SHALL return `true` if and only if the timestamp is within the configured tolerance window (default 5 minutes) of the current time, and not in the future beyond reasonable clock skew.

**Validates: Requirements 1.2, 1.4, 26.1, 26.2**

### Property 3: URL Verification Round-Trip

*For any* `url_verification` request with a challenge value, the system SHALL respond with a body containing exactly that challenge value.

**Validates: Requirements 2.1**

### Property 4: Event Enqueueing

*For any* valid `event_callback` request that passes signature and timestamp verification, the system SHALL enqueue exactly one message to the SQS queue containing the event data.

**Validates: Requirements 3.2**

### Property 5: Message Filtering

*For any* Slack event, the `shouldProcessEvent` function SHALL return `true` if and only if:
- The event `channel_type` is `im` (direct message), AND
- The event has no `bot_id` field, AND
- The event has no `subtype` field

**Validates: Requirements 4.1, 4.2, 4.3, 5.1, 5.2, 5.3**

### Property 6: Classification Type Invariant

*For any* message text, the `classifyMessage` function SHALL return a classification that is exactly one of: `inbox`, `idea`, `decision`, `project`, `task`.

**Validates: Requirements 6.1**

### Property 7: Confidence Bounds Invariant

*For any* classification result, the confidence score SHALL be a number in the range [0.0, 1.0] inclusive.

**Validates: Requirements 6.2**

### Property 8: Confidence Bouncer Behavior

*For any* classification result with confidence below the low threshold:
- The system SHALL send exactly one clarification message to Slack
- The system SHALL NOT create any CodeCommit commits
- The system SHALL NOT send any OmniFocus emails
- The clarification message SHALL include the detected classification options

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 9: Safe Fallback Handling

*For any* classification result with confidence between the low and high thresholds (medium confidence), the system SHALL either:
- Ask a clarifying question, OR
- Default to `inbox` classification and inform the user

**Validates: Requirements 8.1, 8.2**

### Property 10: Conversation Context Management

*For any* clarification request:
- The system SHALL store conversation context with the original message
- When a reply is received within the timeout period, the system SHALL resume processing with both original and reply context
- Context SHALL expire after the configured timeout (default 1 hour)

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 11: Fix Command Parsing

*For any* message text, the `parseFixCommand` function SHALL return a `FixRequest` if and only if the message starts with `fix:` (case-insensitive), and SHALL return `null` otherwise.

**Validates: Requirements 10.1**

### Property 12: Fix Operation Integrity

*For any* successful fix operation:
- The system SHALL create a new commit with the correction
- The new receipt SHALL reference the prior action's event_id
- The receipt SHALL have classification `fix`

**Validates: Requirements 10.2, 10.3, 10.4**

### Property 13: Classification to Path Mapping

*For any* classification and optional slug/date:
- `inbox` → `00-inbox/YYYY-MM-DD.md` (using current date)
- `idea` → `10-ideas/<slug>.md`
- `decision` → `20-decisions/YYYY-MM-DD-<slug>.md`
- `project` → `30-projects/<project-slug>.md`

The `generateFilePath` function SHALL produce paths matching these patterns exactly.

**Validates: Requirements 11.1, 11.2, 11.3, 11.4, 29.3**

### Property 14: Commit Integrity

*For any* commit operation (except the initial commit), the commit SHALL include a valid parent commit reference. If the parent has changed since reading, the operation SHALL retry with the new parent.

**Validates: Requirements 12.1, 12.2**

### Property 15: Append-Only Enforcement

*For any* write operation to `00-inbox/*.md` or `90-receipts/receipts.jsonl`:
- The operation SHALL only append content to the end of the file
- The operation SHALL NOT modify or delete existing content

**Validates: Requirements 13.1, 13.2, 13.3**

### Property 16: Destructive Change Detection

*For any* proposed file modification:
- If the change deletes any content, the system SHALL request confirmation
- If the change rewrites more than 30% of the file, the system SHALL request confirmation
- If confirmation is denied, the change SHALL NOT be applied

**Validates: Requirements 14.1, 14.2, 14.3**

### Property 17: Receipt Logging

*For any* action (commit, task email, clarification, fix):
- The system SHALL append exactly one receipt to `90-receipts/receipts.jsonl`
- The receipt SHALL be a valid JSON object on a single line

**Validates: Requirements 15.1, 15.2**

### Property 18: Receipt Schema Validation

*For any* receipt, it SHALL contain all required fields:
- `timestamp_iso`: valid ISO 8601 string
- `event_id`: non-empty string
- `slack`: object with `user_id`, `channel_id`, `message_ts`
- `classification`: one of `inbox`, `idea`, `decision`, `project`, `task`, `fix`, `clarify`
- `confidence`: number in [0, 1]
- `actions`: array of action objects with `type` and `details`
- `files`: array of strings
- `commit_id`: string or null
- `summary`: non-empty string

**Validates: Requirements 16.1-16.9, 36.1-36.9**

### Property 19: Task Routing

*For any* classification of `task` with confidence above the high threshold:
- The system SHALL send exactly one email to the OmniFocus Mail Drop address
- The receipt SHALL include an action of type `email`

**Validates: Requirements 17.1, 17.3**

### Property 20: Task Email Format

*For any* task email:
- The subject line SHALL contain the task title
- The body SHALL contain the task context/notes
- The body SHALL include a reference to the Slack source (channel + timestamp)

**Validates: Requirements 18.1, 18.2, 18.3, 39.1, 39.2, 39.3**

### Property 21: Exactly-Once Semantics (Idempotency)

*For any* Slack event_id processed multiple times (due to retries):
- The system SHALL use DynamoDB conditional writes to acquire a lock on the event_id
- If the conditional write fails (event_id exists), the system SHALL return success without side effects
- The system SHALL produce at most one CodeCommit commit per event_id
- The system SHALL produce at most one OmniFocus email per event_id
- The system SHALL NOT fail or error on duplicate events
- DynamoDB records SHALL expire via TTL after 7 days

**Validates: Requirements 19.1, 20.2, 20.3, 21.2, 21.3, 22.1, 22.2, 22.3, 24a.1-24a.5**

### Property 22: Slug Generation

*For any* generated slug:
- The slug SHALL be lowercase
- The slug SHALL use hyphens as separators
- The slug SHALL be 3-8 words in length
- The slug SHALL contain only ASCII characters
- Idea slugs SHALL NOT contain dates

**Validates: Requirements 30.1, 30.2, 30.3, 30.4**

### Property 23: Markdown Template Compliance

*For any* generated Markdown artifact:
- Inbox entries SHALL have date title, chronological bullets with timestamps
- Idea notes SHALL have title, context, key points, implications, open questions, source
- Decision notes SHALL have decision statement, date, rationale, alternatives, consequences, source
- Project pages SHALL have objective, status, key decisions, next steps, references
- All artifacts SHALL use headings (not bold), bullets (not prose), ISO dates, no emojis, and include source

**Validates: Requirements 31.1-31.5, 32.1-32.3, 33.1-33.2, 34.1-34.2, 35.1-35.2**

### Property 24: Slack Message Format

*For any* Slack reply:
- Confirmation replies SHALL include classification, files changed, commit id, and fix instruction
- Clarification prompts SHALL ask exactly one question and enumerate valid options

**Validates: Requirements 37.1-37.3, 38.1-38.3**

### Property 25: System Prompt Loading

*For any* worker invocation:
- The system SHALL load the system prompt from `/system/agent-system-prompt.md` in CodeCommit
- The system SHALL compute and cache the prompt's commit_id and SHA-256 hash
- If the system prompt file is missing, the worker SHALL fail with a clear error

**Validates: Requirements 40.1, 40.2, 40.3**

### Property 26: Action Plan Schema Validation

*For any* Action Plan output from AgentCore:
- The Action Plan SHALL be validated against the strict JSON schema
- The Action Plan SHALL contain all required fields: classification, confidence, needs_clarification, file_operations, commit_message, slack_reply_text
- If validation fails, no side effects SHALL be executed

**Validates: Requirements 42.1-42.5, 43.1-43.2**

### Property 27: Action Plan Validation Failure Handling

*For any* invalid Action Plan:
- The system SHALL NOT perform any CodeCommit commits
- The system SHALL NOT send any OmniFocus emails
- The system SHALL reply to Slack with an error message
- The system SHALL append a receipt with validation_errors field populated

**Validates: Requirements 43.2, 43.3, 43.4**

### Property 28: Side Effect Ordering

*For any* Action Plan with multiple side effects:
- CodeCommit writes SHALL execute before OmniFocus email
- OmniFocus email SHALL execute before Slack reply
- If any step fails, subsequent steps SHALL NOT execute
- The receipt SHALL record which steps succeeded and which failed

**Validates: Requirements 44.1, 44.2, 44.3**

### Property 29: Receipt Prompt Metadata

*For any* receipt:
- The receipt SHALL include `prompt_commit_id` matching the commit where the system prompt was read
- The receipt SHALL include `prompt_sha256` matching the SHA-256 hash of the system prompt content
- The prompt metadata SHALL be consistent across all receipts for a single worker invocation

**Validates: Requirements 45.1, 45.2, 45.3**

### Property 30: Memory Strategy — Git as Source of Truth

*For any* durable knowledge artifact (inbox entry, idea, decision, project, receipt):
- The artifact SHALL be stored in CodeCommit only
- The artifact SHALL NOT be stored in AgentCore Memory as the primary copy
- If the same information exists in both Git and AgentCore Memory, Git SHALL be authoritative
- The system SHALL be able to fully reconstruct its knowledge base from Git alone

**Validates: Requirements 46.1-46.5**

### Property 31: AgentCore Memory Constraints

*For any* data stored in AgentCore Memory:
- The data SHALL be limited to preferences, operating assumptions, or short-lived state
- The data SHALL NOT include full note content, receipts, or idempotency keys
- The data SHALL NOT be required for exact reconstruction of the knowledge base

**Validates: Requirements 47.1-47.6**

## Error Handling

### Slack Ingress Errors

| Error Condition | Response | Logging |
|----------------|----------|---------|
| Invalid signature | HTTP 401 Unauthorized | Log event_id (if available), rejection reason |
| Timestamp too old (>5 min) | HTTP 401 Unauthorized | Log timestamp, current time, rejection reason |
| Timestamp in future | HTTP 401 Unauthorized | Log timestamp, current time, rejection reason |
| Malformed JSON payload | HTTP 400 Bad Request | Log parsing error |
| SQS enqueue failure | HTTP 500 Internal Server Error | Log error, retry with exponential backoff |

### Worker Processing Errors

| Error Condition | Behavior | Recovery |
|----------------|----------|----------|
| Duplicate event_id | Return success, no side effects | None needed (idempotent) |
| Bedrock AgentCore timeout | Retry up to 3 times with backoff | Fall back to `inbox` classification |
| Bedrock AgentCore error | Log error, notify user via Slack | Ask user to retry |
| CodeCommit conflict (parent changed) | Retry with new parent commit | Up to 3 retries |
| CodeCommit write failure | Log error, notify user via Slack | Ask user to retry |
| SES email failure | Log error, notify user via Slack | Ask user to retry |
| Slack API failure | Log error | Retry with exponential backoff |
| SSM Parameter not found | Lambda fails to start | Alert via CloudWatch |

### Conversation Context Errors

| Error Condition | Behavior |
|----------------|----------|
| Context expired | Treat as new message, re-classify |
| Context not found | Treat as new message, re-classify |
| Invalid context data | Log warning, treat as new message |

### Fix Operation Errors

| Error Condition | Behavior |
|----------------|----------|
| No prior receipt found | Notify user "Nothing to fix" |
| Prior file not found | Notify user, log error |
| Fix instruction unclear | Ask for clarification |

### System Prompt Errors

| Error Condition | Behavior | Recovery |
|----------------|----------|----------|
| System prompt file missing | Worker fails to start | Alert via CloudWatch, deployment should have caught this |
| System prompt file empty | Worker fails to start | Alert via CloudWatch |
| System prompt malformed | Worker fails to start | Alert via CloudWatch |
| CodeCommit read failure | Retry up to 3 times | Fall back to cached version if available |

### Action Plan Validation Errors

| Error Condition | Behavior |
|----------------|----------|
| Invalid JSON from LLM | Log error, reply to Slack with error, create failure receipt |
| Missing required fields | Log error, reply to Slack with error, create failure receipt |
| Invalid classification value | Log error, reply to Slack with error, create failure receipt |
| Confidence out of bounds | Log error, reply to Slack with error, create failure receipt |
| Invalid file path (outside taxonomy) | Log error, reply to Slack with error, create failure receipt |

### Side Effect Execution Errors

| Error Condition | Behavior |
|----------------|----------|
| CodeCommit write fails | Stop execution, log error, reply to Slack, create partial receipt |
| Email send fails (after commit) | Stop execution, log error, reply to Slack, create partial receipt |
| Slack reply fails (after commit/email) | Log error, create receipt noting Slack failure |

### DLQ Handling

Messages that fail processing after all retries are moved to a Dead Letter Queue (DLQ):
- DLQ messages are retained for 14 days
- CloudWatch alarm triggers on DLQ message count > 0
- Manual review and replay process documented

## Testing Strategy

### Dual Testing Approach

The system uses both unit tests and property-based tests for comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, integration points, and error conditions
- **Property tests**: Verify universal properties across randomly generated inputs

Both are complementary and necessary—unit tests catch concrete bugs while property tests verify general correctness.

### Property-Based Testing Configuration

- **Library**: [fast-check](https://github.com/dubzzz/fast-check) for TypeScript
- **Minimum iterations**: 100 per property test
- **Tagging format**: Each test tagged with `Feature: second-brain-agent, Property {N}: {title}`

### Test Categories

#### 1. Signature and Timestamp Verification Tests

**Property Tests:**
- Property 1: Signature verification (valid signatures accepted, invalid rejected)
- Property 2: Timestamp validation (within window accepted, outside rejected)

**Unit Tests:**
- Edge case: Empty body
- Edge case: Missing timestamp header
- Edge case: Malformed signature format

#### 2. Event Filtering Tests

**Property Tests:**
- Property 5: Message filtering (DM-only, no bots, no subtypes)

**Unit Tests:**
- Example: Valid DM event processed
- Example: Channel event ignored
- Example: Bot message ignored
- Example: Message edit ignored

#### 3. Classification Tests

**Property Tests:**
- Property 6: Classification type invariant
- Property 7: Confidence bounds invariant

**Unit Tests:**
- Example: Clear task message classified as task
- Example: Clear idea message classified as idea
- Example: Ambiguous message has lower confidence

#### 4. Confidence Bouncer Tests

**Property Tests:**
- Property 8: Confidence bouncer behavior
- Property 9: Safe fallback handling

**Unit Tests:**
- Example: Low confidence triggers clarification
- Example: High confidence proceeds without clarification
- Example: Medium confidence defaults to inbox

#### 5. Path Generation Tests

**Property Tests:**
- Property 13: Classification to path mapping
- Property 22: Slug generation

**Unit Tests:**
- Example: Inbox path for specific date
- Example: Idea path with specific slug
- Example: Decision path with date and slug
- Edge case: Very long text produces valid slug

#### 6. Idempotency Tests

**Property Tests:**
- Property 21: Exactly-once semantics

**Unit Tests:**
- Example: First event creates commit
- Example: Duplicate event returns success without commit
- Example: Duplicate event returns success without email

#### 7. Receipt Tests

**Property Tests:**
- Property 17: Receipt logging
- Property 18: Receipt schema validation

**Unit Tests:**
- Example: Commit action produces valid receipt
- Example: Email action produces valid receipt
- Example: Clarification produces valid receipt
- Round-trip: Serialize then parse receipt equals original

#### 8. Template Tests

**Property Tests:**
- Property 23: Markdown template compliance

**Unit Tests:**
- Example: Inbox entry format
- Example: Idea note format
- Example: Decision note format
- Example: Project page format

#### 9. Fix Operation Tests

**Property Tests:**
- Property 11: Fix command parsing
- Property 12: Fix operation integrity

**Unit Tests:**
- Example: "fix: change title" parsed correctly
- Example: "Fix: uppercase" parsed correctly
- Example: "not a fix" returns null
- Example: Fix creates new commit referencing prior

#### 10. Integration Tests

**Unit Tests:**
- End-to-end: DM → Classification → Commit → Receipt → Reply
- End-to-end: DM → Classification → Task Email → Receipt → Reply
- End-to-end: Low confidence → Clarification → Reply → Resume
- End-to-end: Fix command → Correction → Receipt

#### 11. System Prompt Tests

**Property Tests:**
- Property 25: System prompt loading

**Unit Tests:**
- Example: Valid prompt loads successfully
- Example: Missing prompt file causes failure
- Example: Prompt hash computed correctly
- Example: Prompt metadata cached across invocations

#### 12. Action Plan Validation Tests

**Property Tests:**
- Property 26: Action Plan schema validation
- Property 27: Action Plan validation failure handling

**Unit Tests:**
- Example: Valid Action Plan passes validation
- Example: Missing classification fails validation
- Example: Invalid confidence (>1.0) fails validation
- Example: Invalid file path fails validation
- Example: Validation failure creates error receipt

#### 13. Side Effect Ordering Tests

**Property Tests:**
- Property 28: Side effect ordering

**Unit Tests:**
- Example: Commit executes before email
- Example: Email executes before Slack reply
- Example: Commit failure stops email and Slack
- Example: Email failure stops Slack but commit persists

#### 14. Receipt Prompt Metadata Tests

**Property Tests:**
- Property 29: Receipt prompt metadata

**Unit Tests:**
- Example: Receipt includes prompt_commit_id
- Example: Receipt includes prompt_sha256
- Example: All receipts in invocation have same prompt metadata

### CDK Infrastructure Tests

**Snapshot Tests:**
- Stack synthesizes without errors
- Resource counts match expectations

**Assertion Tests:**
- Lambda functions have correct IAM permissions
- SQS queue has DLQ configured
- API Gateway has correct routes
- SSM parameters are referenced (not created with values)

### Test File Structure

```
test/
├── unit/
│   ├── slack-ingress.test.ts
│   ├── classifier.test.ts
│   ├── knowledge-store.test.ts
│   ├── receipt-logger.test.ts
│   ├── task-router.test.ts
│   ├── fix-handler.test.ts
│   ├── templates.test.ts
│   ├── system-prompt-loader.test.ts
│   ├── action-plan-validator.test.ts
│   └── action-plan-executor.test.ts
├── property/
│   ├── signature.property.test.ts
│   ├── filtering.property.test.ts
│   ├── classification.property.test.ts
│   ├── path-generation.property.test.ts
│   ├── idempotency.property.test.ts
│   ├── receipt.property.test.ts
│   ├── templates.property.test.ts
│   ├── system-prompt.property.test.ts
│   ├── action-plan.property.test.ts
│   └── side-effect-ordering.property.test.ts
├── integration/
│   ├── end-to-end.test.ts
│   └── conversation-flow.test.ts
└── cdk/
    ├── stack.test.ts
    └── permissions.test.ts
```

### Mocking Strategy

| Component | Mock Strategy |
|-----------|---------------|
| Bedrock AgentCore | Mock responses with configurable classification/confidence |
| CodeCommit | Local Git repository or mock SDK |
| DynamoDB | LocalStack or mock SDK with conditional write simulation |
| SES | Mock SDK, verify email parameters |
| Slack Web API | Mock SDK, verify message parameters |
| SSM Parameter Store | Environment variables or mock SDK |
| SQS | LocalStack or mock SDK |
| Lambda Function URL | Direct Lambda invocation in tests |
