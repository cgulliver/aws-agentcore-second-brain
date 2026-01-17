---
inclusion: fileMatch
fileMatchPattern: "src/**/*.ts,lib/**/*.ts,test/**/*.ts"
---

# Second Brain Agent — Implementation Reference

This steering file provides concrete TypeScript SDK v3 patterns and code examples for implementing the Second Brain Agent system.

---

## Architecture Decision: Agent Runtime Clarification

> **IMPORTANT**: There are two different "agent runtime" concepts in AWS Bedrock:
>
> 1. **Bedrock Agent Runtime API** (`@aws-sdk/client-bedrock-agent-runtime`) — An API you **invoke** from Lambda to call a pre-built Bedrock Agent
> 2. **AgentCore Runtime** (`@aws-cdk/aws-bedrock-agentcore-alpha`) — A managed service that **hosts** your agent code (container or ZIP)
>
> **This system uses Option 1.**

### Decision Record

**Classification is implemented as a Bedrock Agent (Agent Runtime), invoked by Lambda. AgentCore Runtime is NOT used for the classifier worker.**

**Rationale:**
- Classification is a simple, single-step LLM call — no complex multi-step autonomous workflow
- Lambda architecture is simpler, cheaper, and sufficient for our needs
- Keeps infrastructure minimal (Lambda + SQS + DynamoDB)

**Memory Strategy:**
- **AgentCore Memory** remains the long-lived behavioral/context store (preferences, operating assumptions, clarification state)
- **DynamoDB** handles idempotency and structured state
- **Git (CodeCommit)** is the durable source of truth for all knowledge

**Future Option:**
If classification grows into a complex, multi-step autonomous workflow, we may migrate that worker to AgentCore Runtime.

---

## Classifier Worker Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Classifier Worker (Lambda)                          │
│                                                                             │
│  1. Receive SQS message (Slack event)                                      │
│  2. Check idempotency (DynamoDB conditional write)                         │
│  3. Call Bedrock Agent Runtime InvokeAgent ← NOT AgentCore Runtime         │
│     └─ Receives: classification, confidence, Action Plan JSON              │
│  4. Validate Action Plan                                                   │
│  5. Execute side effects (commit → email → slack)                          │
│  6. Write receipt to CodeCommit                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key SDK Packages

| Purpose | Package | Usage |
|---------|---------|-------|
| Invoke Bedrock Agent | `@aws-sdk/client-bedrock-agent-runtime` | `InvokeAgentCommand` |
| AgentCore Memory (behavioral context) | `bedrock-agentcore` (Python) | Store preferences, clarification state |
| CDK for AgentCore Memory | `@aws-cdk/aws-bedrock-agentcore-alpha` | Provision Memory resource |

---

## AgentCore Memory Integration

AgentCore Memory is used for **behavioral context only** — NOT for durable knowledge storage.

### What Goes in AgentCore Memory

| Category | Example | Store Here? |
|----------|---------|-------------|
| User preferences | "confidence threshold = 0.85" | ✓ Yes |
| Operating assumptions | "tasks go to OmniFocus" | ✓ Yes |
| Clarification state | "awaiting classification response" | ✓ Yes (short-lived) |
| Full notes | idea content, decision rationale | ✗ No (Git only) |
| Receipts | audit log entries | ✗ No (Git only) |
| Idempotency keys | event_id tracking | ✗ No (DynamoDB only) |

### Memory Strategies (LTM)

For behavioral context, use these built-in strategies:

```typescript
// CDK: Create AgentCore Memory with strategies
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

const memory = new agentcore.Memory(this, 'SecondBrainMemory', {
  memoryName: 'second_brain_behavioral_context',
  description: 'Behavioral context for Second Brain agent',
  expirationDuration: cdk.Duration.days(90),
  memoryStrategies: [
    agentcore.MemoryStrategy.usingBuiltInUserPreference(), // Learn user preferences
    agentcore.MemoryStrategy.usingBuiltInSummarization(),  // Session summaries
  ],
});
```

### Memory Client Usage (Python — for reference)

```python
from bedrock_agentcore.memory import MemoryClient

client = MemoryClient(region_name="us-east-1")

# Store conversation event (short-term memory)
client.create_event(
    memory_id="your-memory-id",
    actor_id="slack-user-U012ABCDEF",
    session_id="channel-D012XYZ123",
    messages=[
        ("I prefer high confidence threshold", "USER"),
        ("Noted. I'll use 0.9 as your confidence threshold.", "ASSISTANT"),
    ],
)

# Retrieve preferences (long-term memory)
memories = client.retrieve_memories(
    memory_id="your-memory-id",
    namespace="/preferences/slack-user-U012ABCDEF",
    query="confidence threshold preference"
)
```

> **Note:** AgentCore Memory SDK is Python-only. For TypeScript Lambda, either:
> 1. Use AWS SDK directly with AgentCore Memory APIs
> 2. Create a thin Python Lambda for memory operations
> 3. Store preferences in DynamoDB (simpler for v1)

---

## AWS SDK v3 Patterns

### Lambda Function URL Handler

```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const body = event.body ?? '';
  const timestamp = event.headers['x-slack-request-timestamp'] ?? '';
  const signature = event.headers['x-slack-signature'] ?? '';
  
  // Function URL uses APIGatewayProxyEventV2 (HTTP API format)
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
```

### Slack Signature Verification

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  // Replay protection: reject timestamps older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Math.abs(now - ts) > 300) {
    return false;
  }

  // Compute expected signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', signingSecret);
  hmac.update(sigBasestring);
  const expectedSignature = `v0=${hmac.digest('hex')}`;

  // Timing-safe comparison
  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}
```

### SQS Send Message

```typescript
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

export async function enqueueEvent(
  queueUrl: string,
  message: SQSEventMessage
): Promise<string> {
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
    // Use event_id as deduplication ID for FIFO queues (optional)
    // MessageDeduplicationId: message.eventId,
  });
  
  const response = await sqs.send(command);
  return response.MessageId!;
}
```

### DynamoDB Conditional Write (Idempotency)

```typescript
import { 
  DynamoDBClient, 
  PutItemCommand,
  ConditionalCheckFailedException 
} from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({});

export async function tryAcquireLock(
  tableName: string,
  eventId: string,
  ttlDays: number = 7
): Promise<boolean> {
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + (ttlDays * 24 * 60 * 60);

  try {
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: {
        event_id: { S: eventId },
        processed_at: { S: now.toISOString() },
        expires_at: { N: expiresAt.toString() },
        status: { S: 'processing' },
      },
      // Only succeed if event_id doesn't exist
      ConditionExpression: 'attribute_not_exists(event_id)',
    }));
    return true; // Lock acquired
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false; // Duplicate event
    }
    throw error;
  }
}

export async function markCompleted(
  tableName: string,
  eventId: string,
  summary: string
): Promise<void> {
  const { UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');
  
  await dynamodb.send(new UpdateItemCommand({
    TableName: tableName,
    Key: { event_id: { S: eventId } },
    UpdateExpression: 'SET #status = :status, result_summary = :summary',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': { S: 'completed' },
      ':summary': { S: summary },
    },
  }));
}
```

### CodeCommit Operations

```typescript
import {
  CodeCommitClient,
  GetBranchCommand,
  GetFileCommand,
  CreateCommitCommand,
} from '@aws-sdk/client-codecommit';

const codecommit = new CodeCommitClient({});

export async function getLatestCommitId(
  repositoryName: string,
  branchName: string = 'main'
): Promise<string | null> {
  try {
    const response = await codecommit.send(new GetBranchCommand({
      repositoryName,
      branchName,
    }));
    return response.branch?.commitId ?? null;
  } catch (error: any) {
    if (error.name === 'BranchDoesNotExistException') {
      return null;
    }
    throw error;
  }
}

export async function readFile(
  repositoryName: string,
  filePath: string,
  commitSpecifier: string = 'main'
): Promise<string | null> {
  try {
    const response = await codecommit.send(new GetFileCommand({
      repositoryName,
      filePath,
      commitSpecifier,
    }));
    return Buffer.from(response.fileContent!).toString('utf-8');
  } catch (error: any) {
    if (error.name === 'FileDoesNotExistException') {
      return null;
    }
    throw error;
  }
}

export async function createCommit(
  repositoryName: string,
  branchName: string,
  parentCommitId: string | null,
  files: Array<{ path: string; content: string }>,
  commitMessage: string
): Promise<string> {
  const putFiles = files.map(f => ({
    filePath: f.path,
    fileContent: Buffer.from(f.content, 'utf-8'),
    fileMode: 'NORMAL' as const,
  }));

  const response = await codecommit.send(new CreateCommitCommand({
    repositoryName,
    branchName,
    parentCommitId: parentCommitId ?? undefined,
    putFiles,
    commitMessage,
    authorName: 'Second Brain Agent',
    email: 'agent@second-brain.local',
  }));

  return response.commitId!;
}

// Append-only pattern for inbox and receipts
export async function appendToFile(
  repositoryName: string,
  branchName: string,
  filePath: string,
  newContent: string,
  commitMessage: string
): Promise<string> {
  // Get current commit
  const parentCommitId = await getLatestCommitId(repositoryName, branchName);
  
  // Read existing content
  const existingContent = await readFile(repositoryName, filePath) ?? '';
  
  // Append new content
  const updatedContent = existingContent + newContent;
  
  // Create commit with retry on conflict
  let retries = 3;
  while (retries > 0) {
    try {
      return await createCommit(
        repositoryName,
        branchName,
        parentCommitId,
        [{ path: filePath, content: updatedContent }],
        commitMessage
      );
    } catch (error: any) {
      if (error.name === 'ParentCommitIdOutdatedException' && retries > 1) {
        retries--;
        // Re-read and retry
        const newParent = await getLatestCommitId(repositoryName, branchName);
        const newExisting = await readFile(repositoryName, filePath) ?? '';
        // Re-append to latest content
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to append after retries');
}
```

### SES Email Sending

```typescript
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});

export async function sendTaskEmail(
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string
): Promise<string> {
  const response = await ses.send(new SendEmailCommand({
    Source: fromEmail,
    Destination: {
      ToAddresses: [toEmail],
    },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Text: { Data: body, Charset: 'UTF-8' },
      },
    },
  }));

  return response.MessageId!;
}

// OmniFocus Mail Drop format
export function formatOmniFocusEmail(
  taskTitle: string,
  context: string,
  slackChannel: string,
  messageTs: string
): { subject: string; body: string } {
  return {
    subject: taskTitle, // Becomes task title in OmniFocus
    body: `${context}

---
Source: Slack DM — ${slackChannel} @ ${messageTs}`,
  };
}
```

### SSM Parameter Store

```typescript
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

// Cache parameters to avoid repeated calls
const parameterCache = new Map<string, string>();

export async function getParameter(
  name: string,
  decrypt: boolean = true
): Promise<string> {
  if (parameterCache.has(name)) {
    return parameterCache.get(name)!;
  }

  const response = await ssm.send(new GetParameterCommand({
    Name: name,
    WithDecryption: decrypt,
  }));

  const value = response.Parameter?.Value;
  if (!value) {
    throw new Error(`Parameter ${name} not found or empty`);
  }

  parameterCache.set(name, value);
  return value;
}

// Parameter paths for Second Brain
export const SSM_PATHS = {
  SLACK_SIGNING_SECRET: '/second-brain/slack-signing-secret',
  SLACK_BOT_TOKEN: '/second-brain/slack-bot-token',
  OMNIFOCUS_MAILDROP_EMAIL: '/second-brain/omnifocus-maildrop-email',
} as const;
```

### Slack Web API

```typescript
import { WebClient } from '@slack/web-api';

export async function sendSlackReply(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<string> {
  const client = new WebClient(botToken);
  
  const response = await client.chat.postMessage({
    channel,
    text,
    thread_ts: threadTs,
  });

  return response.ts!;
}

// Confirmation reply format
export function formatConfirmationReply(
  classification: string,
  files: string[],
  commitId: string | null
): string {
  const fileList = files.length > 0 
    ? `\nFiles: ${files.join(', ')}` 
    : '';
  const commit = commitId 
    ? `\nCommit: \`${commitId.substring(0, 7)}\`` 
    : '';
  
  return `Captured as *${classification}*${fileList}${commit}

Reply \`fix: <instruction>\` to correct.`;
}

// Clarification prompt format
export function formatClarificationReply(
  question: string,
  options: string[]
): string {
  const optionList = options.map(o => `• ${o}`).join('\n');
  return `${question}

${optionList}

Or reply \`reclassify: <type>\` to specify directly.`;
}
```

### Bedrock Agent Runtime Integration

The Second Brain Agent uses Bedrock Agent Runtime to invoke a pre-configured agent for classification and action plan generation.

```typescript
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

const bedrockAgent = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION });

/**
 * Invokes the Second Brain agent to classify a message and generate an Action Plan.
 * 
 * @param agentId - The Bedrock Agent ID
 * @param agentAliasId - The Agent Alias ID (use TSTALIASID for draft)
 * @param sessionId - Session ID for conversation continuity (use Slack channel_id + user_id)
 * @param inputText - The user's message to classify
 * @param systemPrompt - The system prompt loaded from CodeCommit
 * @returns The complete response containing the Action Plan JSON
 */
export async function invokeClassifier(
  agentId: string,
  agentAliasId: string,
  sessionId: string,
  inputText: string,
  systemPrompt: string
): Promise<string> {
  // Construct the full prompt with system context
  const fullPrompt = `${systemPrompt}

---
User Message:
${inputText}

---
Respond with a valid Action Plan JSON object.`;

  const command = new InvokeAgentCommand({
    agentId,
    agentAliasId,
    sessionId,
    inputText: fullPrompt,
  });

  try {
    const response = await bedrockAgent.send(command);

    if (response.completion === undefined) {
      throw new Error('Bedrock Agent returned undefined completion');
    }

    // Collect streaming response chunks
    let completion = '';
    for await (const chunkEvent of response.completion) {
      const chunk = chunkEvent.chunk;
      if (chunk?.bytes) {
        const decodedResponse = new TextDecoder('utf-8').decode(chunk.bytes);
        completion += decodedResponse;
      }
    }

    return completion;
  } catch (error) {
    console.error('Bedrock Agent invocation failed:', error);
    throw error;
  }
}

/**
 * Parse the Action Plan JSON from the agent's response.
 * The agent may include markdown code blocks or extra text.
 */
export function extractActionPlanJson(response: string): unknown {
  // Try to extract JSON from markdown code block
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim());
  }

  // Try to find raw JSON object
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error('No valid JSON found in agent response');
}
```

### Session Management

Use a consistent session ID format for conversation continuity:

```typescript
/**
 * Generate a session ID for Bedrock Agent conversations.
 * Format: {channel_id}:{user_id}
 * This allows the agent to maintain context within a DM conversation.
 */
export function generateSessionId(channelId: string, userId: string): string {
  return `${channelId}:${userId}`;
}
```

## CDK Patterns

### Lambda Function URL

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

const ingressLambda = new NodejsFunction(this, 'IngressLambda', {
  runtime: lambda.Runtime.NODEJS_20_X,
  entry: 'src/handlers/ingress.ts',
  handler: 'handler',
  timeout: cdk.Duration.seconds(10),
  memorySize: 256,
  environment: {
    QUEUE_URL: queue.queueUrl,
  },
});

// Add Function URL (Auth = NONE for Slack webhook)
const functionUrl = ingressLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
  },
});

// Output the URL for Slack configuration
new cdk.CfnOutput(this, 'SlackWebhookUrl', {
  value: functionUrl.url,
});
```

### SQS with DLQ

```typescript
import * as sqs from 'aws-cdk-lib/aws-sqs';

const dlq = new sqs.Queue(this, 'DeadLetterQueue', {
  queueName: 'second-brain-dlq',
  retentionPeriod: cdk.Duration.days(14),
});

const queue = new sqs.Queue(this, 'EventQueue', {
  queueName: 'second-brain-events',
  visibilityTimeout: cdk.Duration.seconds(60),
  deadLetterQueue: {
    queue: dlq,
    maxReceiveCount: 3,
  },
});
```

### DynamoDB with TTL

```typescript
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
  tableName: 'second-brain-idempotency',
  partitionKey: { name: 'event_id', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expires_at',
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
```

### Lambda SQS Event Source

```typescript
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

workerLambda.addEventSource(new SqsEventSource(queue, {
  batchSize: 1, // Process one event at a time for simplicity
  maxBatchingWindow: cdk.Duration.seconds(0),
  reportBatchItemFailures: true,
}));
```

## Property-Based Testing with fast-check

### Basic Property Test Structure

```typescript
import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Feature: second-brain-agent, Property 1: Signature Verification', () => {
  it('accepts valid signatures and rejects invalid ones', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }), // body
        fc.integer({ min: 0 }), // timestamp
        fc.hexaString({ minLength: 64, maxLength: 64 }), // secret
        (body, timestamp, secret) => {
          // Compute valid signature
          const validSig = computeSignature(secret, timestamp.toString(), body);
          
          // Valid signature should be accepted
          expect(verifySlackSignature(secret, timestamp.toString(), body, validSig)).toBe(true);
          
          // Invalid signature should be rejected
          expect(verifySlackSignature(secret, timestamp.toString(), body, 'v0=invalid')).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Arbitraries for Domain Types

```typescript
import * as fc from 'fast-check';

// Classification arbitrary
const classificationArb = fc.constantFrom(
  'inbox', 'idea', 'decision', 'project', 'task'
);

// Confidence arbitrary (0.0 to 1.0)
const confidenceArb = fc.float({ min: 0, max: 1, noNaN: true });

// Slack event arbitrary
const slackEventArb = fc.record({
  type: fc.constant('event_callback'),
  event_id: fc.hexaString({ minLength: 10, maxLength: 20 }),
  event: fc.record({
    type: fc.constant('message'),
    channel_type: fc.constantFrom('im', 'channel', 'group'),
    user: fc.hexaString({ minLength: 9, maxLength: 11 }),
    text: fc.string({ minLength: 1, maxLength: 1000 }),
    ts: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.'), { minLength: 10, maxLength: 20 }),
    bot_id: fc.option(fc.hexaString({ minLength: 9, maxLength: 11 }), { nil: undefined }),
    subtype: fc.option(fc.constantFrom('message_changed', 'message_deleted'), { nil: undefined }),
  }),
});

// Receipt arbitrary
const receiptArb = fc.record({
  timestamp_iso: fc.date().map(d => d.toISOString()),
  event_id: fc.hexaString({ minLength: 10, maxLength: 20 }),
  slack: fc.record({
    user_id: fc.hexaString({ minLength: 9, maxLength: 11 }),
    channel_id: fc.hexaString({ minLength: 9, maxLength: 11 }),
    message_ts: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.'), { minLength: 10, maxLength: 20 }),
  }),
  classification: fc.constantFrom('inbox', 'idea', 'decision', 'project', 'task', 'fix', 'clarify'),
  confidence: confidenceArb,
  actions: fc.array(fc.record({
    type: fc.constantFrom('commit', 'email', 'slack_reply'),
    details: fc.dictionary(fc.string(), fc.string()),
  })),
  files: fc.array(fc.string()),
  commit_id: fc.option(fc.hexaString({ minLength: 40, maxLength: 40 }), { nil: null }),
  summary: fc.string({ minLength: 1 }),
});
```

### Property Test Examples

```typescript
// Property 5: Message Filtering
describe('Feature: second-brain-agent, Property 5: Message Filtering', () => {
  it('only processes DM events without bot_id or subtype', () => {
    fc.assert(
      fc.property(slackEventArb, (event) => {
        const shouldProcess = shouldProcessEvent(event);
        
        const isDM = event.event.channel_type === 'im';
        const hasBot = event.event.bot_id !== undefined;
        const hasSubtype = event.event.subtype !== undefined;
        
        // Should process iff: DM AND no bot AND no subtype
        expect(shouldProcess).toBe(isDM && !hasBot && !hasSubtype);
      }),
      { numRuns: 100 }
    );
  });
});

// Property 22: Slug Generation
describe('Feature: second-brain-agent, Property 22: Slug Generation', () => {
  it('generates valid slugs', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 10, maxLength: 500 }), (text) => {
        const slug = generateSlug(text);
        
        // Lowercase
        expect(slug).toBe(slug.toLowerCase());
        
        // Hyphen-separated (no spaces, underscores, etc.)
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        
        // 3-8 words
        const wordCount = slug.split('-').length;
        expect(wordCount).toBeGreaterThanOrEqual(3);
        expect(wordCount).toBeLessThanOrEqual(8);
        
        // ASCII only
        expect(slug).toMatch(/^[\x00-\x7F]+$/);
      }),
      { numRuns: 100 }
    );
  });
});
```

## Action Plan Schema

```typescript
import Ajv from 'ajv';

const actionPlanSchema = {
  type: 'object',
  required: [
    'classification',
    'confidence',
    'needs_clarification',
    'file_operations',
    'commit_message',
    'slack_reply_text',
  ],
  properties: {
    classification: {
      type: 'string',
      enum: ['inbox', 'idea', 'decision', 'project', 'task'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    needs_clarification: { type: 'boolean' },
    clarification_prompt: { type: 'string' },
    file_operations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'operation', 'content'],
        properties: {
          path: { type: 'string', pattern: '^(00-inbox|10-ideas|20-decisions|30-projects|90-receipts)/' },
          operation: { type: 'string', enum: ['create', 'append', 'update'] },
          content: { type: 'string' },
        },
      },
    },
    commit_message: { type: 'string', minLength: 1 },
    omnifocus_email: {
      type: ['object', 'null'],
      properties: {
        subject: { type: 'string', minLength: 1 },
        body: { type: 'string' },
      },
      required: ['subject', 'body'],
    },
    slack_reply_text: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

const ajv = new Ajv();
const validateActionPlan = ajv.compile(actionPlanSchema);

export function validatePlan(plan: unknown): { valid: boolean; errors: string[] } {
  const valid = validateActionPlan(plan);
  return {
    valid: !!valid,
    errors: validateActionPlan.errors?.map(e => `${e.instancePath} ${e.message}`) ?? [],
  };
}
```

## File Path Patterns

```typescript
// Path generation for each classification
export function generateFilePath(
  classification: Classification,
  slug?: string,
  date: Date = new Date()
): string {
  const isoDate = date.toISOString().split('T')[0]; // YYYY-MM-DD
  
  switch (classification) {
    case 'inbox':
      return `00-inbox/${isoDate}.md`;
    case 'idea':
      if (!slug) throw new Error('Slug required for idea');
      return `10-ideas/${slug}.md`;
    case 'decision':
      if (!slug) throw new Error('Slug required for decision');
      return `20-decisions/${isoDate}-${slug}.md`;
    case 'project':
      if (!slug) throw new Error('Slug required for project');
      return `30-projects/${slug}.md`;
    case 'task':
      // Tasks don't create files, they send emails
      throw new Error('Tasks do not have file paths');
    default:
      throw new Error(`Unknown classification: ${classification}`);
  }
}
```

## Receipt Format

```typescript
export interface Receipt {
  timestamp_iso: string;
  event_id: string;
  slack: {
    user_id: string;
    channel_id: string;
    message_ts: string;
  };
  classification: 'inbox' | 'idea' | 'decision' | 'project' | 'task' | 'fix' | 'clarify';
  confidence: number;
  actions: Array<{
    type: 'commit' | 'email' | 'slack_reply';
    details: Record<string, unknown>;
  }>;
  files: string[];
  commit_id: string | null;
  prior_commit_id: string | null;
  prompt_commit_id: string;
  prompt_sha256: string;
  summary: string;
  validation_errors?: string[];
}

export function serializeReceipt(receipt: Receipt): string {
  return JSON.stringify(receipt);
}

export function parseReceipt(line: string): Receipt {
  return JSON.parse(line) as Receipt;
}
```


## Worker Lambda Handler Pattern

The Worker Lambda processes events from SQS and orchestrates all components:

```typescript
import { SQSHandler, SQSRecord } from 'aws-lambda';

interface WorkerContext {
  systemPrompt: SystemPrompt;
  idempotencyTable: string;
  repositoryName: string;
  omniFocusEmail: string;
  slackBotToken: string;
  agentId: string;
  agentAliasId: string;
}

// Cache system prompt on cold start
let cachedContext: WorkerContext | null = null;

async function initializeContext(): Promise<WorkerContext> {
  if (cachedContext) return cachedContext;

  const [systemPrompt, omniFocusEmail, slackBotToken] = await Promise.all([
    loadSystemPrompt({
      repositoryName: process.env.REPOSITORY_NAME!,
      branchName: 'main',
      promptPath: '/system/agent-system-prompt.md',
    }),
    getParameter(SSM_PATHS.OMNIFOCUS_MAILDROP_EMAIL),
    getParameter(SSM_PATHS.SLACK_BOT_TOKEN),
  ]);

  cachedContext = {
    systemPrompt,
    idempotencyTable: process.env.IDEMPOTENCY_TABLE!,
    repositoryName: process.env.REPOSITORY_NAME!,
    omniFocusEmail,
    slackBotToken,
    agentId: process.env.AGENT_ID!,
    agentAliasId: process.env.AGENT_ALIAS_ID!,
  };

  return cachedContext;
}

export const handler: SQSHandler = async (event) => {
  const context = await initializeContext();

  for (const record of event.Records) {
    await processRecord(record, context);
  }
};

async function processRecord(
  record: SQSRecord,
  context: WorkerContext
): Promise<void> {
  const message: SQSEventMessage = JSON.parse(record.body);
  const { eventId, channelId, userId, messageText, messageTs } = message;

  // Step 1: Idempotency check
  const lockAcquired = await tryAcquireLock(context.idempotencyTable, eventId);
  if (!lockAcquired) {
    console.log(`Duplicate event ${eventId}, skipping`);
    return;
  }

  try {
    // Step 2: Invoke classifier
    const sessionId = generateSessionId(channelId, userId);
    const agentResponse = await invokeClassifier(
      context.agentId,
      context.agentAliasId,
      sessionId,
      messageText,
      context.systemPrompt.content
    );

    // Step 3: Parse and validate Action Plan
    const rawPlan = extractActionPlanJson(agentResponse);
    const validation = validatePlan(rawPlan);

    if (!validation.valid) {
      // Handle validation failure
      await handleValidationFailure(
        context,
        eventId,
        channelId,
        userId,
        messageTs,
        validation.errors
      );
      return;
    }

    const plan = rawPlan as ActionPlan;

    // Step 4: Check confidence bouncer
    if (plan.needs_clarification) {
      await handleClarification(context, plan, channelId, userId, messageTs, eventId);
      return;
    }

    // Step 5: Execute Action Plan (commit → email → slack)
    const result = await executeActionPlan(plan, {
      eventId,
      slackContext: { channelId, userId, messageTs },
      promptMetadata: context.systemPrompt.metadata,
    });

    // Step 6: Mark completed
    await markCompleted(context.idempotencyTable, eventId, result.summary);

  } catch (error) {
    console.error(`Error processing event ${eventId}:`, error);
    await markFailed(context.idempotencyTable, eventId, String(error));
    throw error; // Let SQS retry
  }
}

async function handleValidationFailure(
  context: WorkerContext,
  eventId: string,
  channelId: string,
  userId: string,
  messageTs: string,
  errors: string[]
): Promise<void> {
  // Send error to Slack
  await sendSlackReply(
    context.slackBotToken,
    channelId,
    `I couldn't process that message. Please try rephrasing.\n\nError: ${errors[0]}`,
    messageTs
  );

  // Create failure receipt
  const receipt = createReceipt(
    eventId,
    { channelId, userId, messageTs },
    'clarify',
    0,
    [{ type: 'slack_reply', details: { error: true } }],
    [],
    null,
    `Validation failed: ${errors.join(', ')}`
  );
  receipt.validation_errors = errors;

  await appendReceipt({ repositoryName: context.repositoryName, branchName: 'main' }, receipt);
  await markFailed(context.idempotencyTable, eventId, `Validation: ${errors[0]}`);
}

async function handleClarification(
  context: WorkerContext,
  plan: ActionPlan,
  channelId: string,
  userId: string,
  messageTs: string,
  eventId: string
): Promise<void> {
  // Send clarification to Slack
  await sendSlackReply(
    context.slackBotToken,
    channelId,
    plan.clarification_prompt!,
    messageTs
  );

  // Store conversation context for follow-up
  // (Implementation depends on conversation store design)

  // Create clarification receipt
  const receipt = createReceipt(
    eventId,
    { channelId, userId, messageTs },
    'clarify',
    plan.confidence,
    [{ type: 'slack_reply', details: { clarification: true } }],
    [],
    null,
    `Asked for clarification: ${plan.classification}`
  );

  await appendReceipt({ repositoryName: context.repositoryName, branchName: 'main' }, receipt);
  await markCompleted(context.idempotencyTable, eventId, 'Clarification sent');
}
```

## Side Effect Executor

Execute side effects in strict order: commit → email → slack

```typescript
interface ExecutionResult {
  success: boolean;
  commitId?: string;
  emailMessageId?: string;
  slackReplyTs?: string;
  failedStep?: 'commit' | 'email' | 'slack';
  error?: string;
  summary: string;
}

export async function executeActionPlan(
  plan: ActionPlan,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    success: false,
    summary: '',
  };

  const files: string[] = [];
  let commitId: string | null = null;

  // Step 1: CodeCommit writes
  if (plan.file_operations.length > 0) {
    try {
      for (const op of plan.file_operations) {
        files.push(op.path);
        
        if (op.operation === 'append') {
          commitId = await appendToFile(
            context.repositoryName,
            'main',
            op.path,
            op.content,
            plan.commit_message
          );
        } else {
          commitId = await createCommit(
            context.repositoryName,
            'main',
            await getLatestCommitId(context.repositoryName),
            [{ path: op.path, content: op.content }],
            plan.commit_message
          );
        }
      }
      result.commitId = commitId ?? undefined;
    } catch (error) {
      result.failedStep = 'commit';
      result.error = String(error);
      result.summary = `Commit failed: ${error}`;
      return result;
    }
  }

  // Step 2: OmniFocus email (only for tasks)
  if (plan.omnifocus_email) {
    try {
      const messageId = await sendTaskEmail(
        process.env.SES_FROM_EMAIL!,
        context.omniFocusEmail,
        plan.omnifocus_email.subject,
        plan.omnifocus_email.body
      );
      result.emailMessageId = messageId;
    } catch (error) {
      result.failedStep = 'email';
      result.error = String(error);
      result.summary = `Email failed after commit ${commitId}: ${error}`;
      // Still create receipt for partial success
      await createPartialReceipt(context, plan, files, commitId, 'email', error);
      return result;
    }
  }

  // Step 3: Slack reply
  try {
    const replyTs = await sendSlackReply(
      context.slackBotToken,
      context.slackContext.channelId,
      plan.slack_reply_text,
      context.slackContext.messageTs
    );
    result.slackReplyTs = replyTs;
  } catch (error) {
    result.failedStep = 'slack';
    result.error = String(error);
    // Slack failure is non-fatal, still mark success
    console.error('Slack reply failed:', error);
  }

  // Create success receipt
  result.success = true;
  result.summary = `${plan.classification}: ${files.join(', ')}${commitId ? ` (${commitId.substring(0, 7)})` : ''}`;

  const receipt = createReceipt(
    context.eventId,
    context.slackContext,
    plan.classification,
    plan.confidence,
    buildActions(result, plan),
    files,
    commitId,
    result.summary
  );
  receipt.prompt_commit_id = context.promptMetadata.commitId;
  receipt.prompt_sha256 = context.promptMetadata.sha256;

  await appendReceipt({ repositoryName: context.repositoryName, branchName: 'main' }, receipt);

  return result;
}

function buildActions(result: ExecutionResult, plan: ActionPlan): ReceiptAction[] {
  const actions: ReceiptAction[] = [];

  if (result.commitId) {
    actions.push({
      type: 'commit',
      details: { commit_id: result.commitId, message: plan.commit_message },
    });
  }

  if (result.emailMessageId) {
    actions.push({
      type: 'email',
      details: { message_id: result.emailMessageId, subject: plan.omnifocus_email!.subject },
    });
  }

  if (result.slackReplyTs) {
    actions.push({
      type: 'slack_reply',
      details: { ts: result.slackReplyTs },
    });
  }

  return actions;
}
```

## Error Handling Patterns

### Retry with Exponential Backoff

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 100
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on validation errors
      if (error instanceof ValidationError) {
        throw error;
      }

      // Exponential backoff
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

### CodeCommit Conflict Handling

```typescript
async function commitWithConflictRetry(
  repositoryName: string,
  branchName: string,
  files: Array<{ path: string; content: string }>,
  commitMessage: string,
  maxRetries: number = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const parentCommitId = await getLatestCommitId(repositoryName, branchName);

    try {
      return await createCommit(
        repositoryName,
        branchName,
        parentCommitId,
        files,
        commitMessage
      );
    } catch (error: any) {
      if (error.name === 'ParentCommitIdOutdatedException' && attempt < maxRetries - 1) {
        console.log(`Commit conflict, retrying (attempt ${attempt + 1})`);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to commit after max retries');
}
```
