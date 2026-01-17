# Implementation Tasks: Second Brain Agent

## Task 1: Project Setup and CDK Foundation

- [ ] 1.1 Initialize CDK TypeScript project with two-stack architecture
  - Create `cdk.json`, `tsconfig.json`, `package.json`
  - Configure CDK app entry point
  - Set up `lib/ingress-stack.ts` and `lib/core-stack.ts` scaffolds
  - **Validates: Requirement 28**

- [ ] 1.2 Configure TypeScript and testing infrastructure
  - Install dependencies: `aws-cdk-lib`, `constructs`, `esbuild`, `vitest`, `fast-check`
  - Configure `vitest.config.ts` for unit and property tests
  - Set up `test/` directory structure per design
  - **Validates: Requirement 28**

- [ ] 1.3 Create shared types and interfaces
  - Create `src/types/slack.ts` with Slack event interfaces
  - Create `src/types/classification.ts` with Classification type
  - Create `src/types/receipt.ts` with Receipt interface
  - Create `src/types/action-plan.ts` with ActionPlan interface
  - **Validates: Requirements 6, 15, 16, 36, 42**

## Task 2: Ingress Stack Infrastructure

- [ ] 2.1 Create SQS Queue with DLQ
  - Define primary queue with visibility timeout
  - Define dead-letter queue with 14-day retention
  - Configure redrive policy (maxReceiveCount: 3)
  - **Validates: Requirement 3, 28**

- [ ] 2.2 Create Ingress Lambda function
  - Define Lambda function with Node.js 20 runtime
  - Configure Lambda Function URL (Auth = NONE)
  - Set environment variables for queue URL
  - Grant SQS send permissions
  - **Validates: Requirements 3, 28**

- [ ] 2.3 Configure SSM Parameter references for Ingress
  - Reference `/second-brain/slack-signing-secret` (SecureString)
  - Grant Lambda read access to parameter
  - **Validates: Requirements 23, 25**

- [ ] 2.4 Export Ingress Stack outputs
  - Export SQS Queue ARN for Core Stack
  - Export Lambda Function URL for Slack configuration
  - **Validates: Requirement 28**

## Task 3: Core Stack Infrastructure

- [ ] 3.1 Create DynamoDB idempotency table
  - Define table with `event_id` partition key
  - Enable TTL on `expires_at` attribute
  - Configure PAY_PER_REQUEST billing
  - **Validates: Requirements 21, 24a**

- [ ] 3.2 Create CodeCommit repository
  - Define repository with description
  - Initialize with system prompt file path
  - **Validates: Requirements 11, 29, 40**

- [ ] 3.3 Create Bedrock Agent for classification
  - Define Bedrock Agent with Claude-class foundation model
  - Configure Agent Instructions (static safety constraints, output contract)
  - Parameterize model ID per environment
  - Create agent alias for invocation
  - **Validates: Requirements 6.3, 41**

- [ ] 3.4 Create Worker Lambda function
  - Define Lambda function with Node.js 20 runtime
  - Configure SQS event source from Ingress queue
  - Set timeout appropriate for Bedrock Agent calls (30s)
  - Set environment variables: AGENT_ID, AGENT_ALIAS_ID, REPOSITORY_NAME
  - **Validates: Requirements 3, 28**

- [ ] 3.5 Configure Worker Lambda permissions
  - Grant DynamoDB read/write for idempotency table
  - Grant CodeCommit read/write for repository
  - Grant SES send email permission
  - Grant Bedrock Agent invoke permission (`bedrock:InvokeAgent`)
  - Grant SSM read for bot-token and maildrop-email
  - **Validates: Requirements 23, 25**

- [ ] 3.6 Create SES email identity
  - Define email identity for sender address
  - Configure for OmniFocus Mail Drop sending
  - **Validates: Requirements 17, 28**

## Task 4: Slack Ingress Component

- [ ] 4.1 Implement Slack signature verification
  - Implement `verifySlackSignature()` using HMAC-SHA256
  - Compute signature as `v0={timestamp}:{body}`
  - Compare with `x-slack-signature` header
  - **Validates: Requirements 1.1, 1.3**

- [ ] 4.2 Implement timestamp validation
  - Implement `isValidTimestamp()` function
  - Reject timestamps older than 5 minutes
  - Reject timestamps in the future (with clock skew tolerance)
  - **Validates: Requirements 1.2, 1.4, 26.1, 26.2**

- [ ] 4.3 Implement URL verification handler
  - Parse `url_verification` request type
  - Return challenge value with HTTP 200
  - **Validates: Requirements 2.1, 2.2**

- [ ] 4.4 Implement event filtering
  - Implement `shouldProcessEvent()` function
  - Filter for `channel_type === 'im'` only
  - Reject events with `bot_id` field
  - Reject events with `subtype` field
  - **Validates: Requirements 4.1-4.3, 5.1-5.3**

- [ ] 4.5 Implement SQS message enqueueing
  - Format SQSEventMessage with required fields
  - Send to SQS queue
  - Return HTTP 200 immediately
  - **Validates: Requirements 3.1, 3.2, 3.3**

- [ ] 4.6 Implement Ingress Lambda handler
  - Wire together signature verification, timestamp check, filtering, enqueueing
  - Handle errors with appropriate HTTP status codes
  - **Validates: Requirements 1-5**

## Task 5: Idempotency Guard Component

- [ ] 5.1 Implement DynamoDB conditional write for lock acquisition
  - Implement `tryAcquireLock()` with ConditionExpression
  - Set TTL to 7 days from now
  - Return false on ConditionalCheckFailedException
  - **Validates: Requirements 21.2, 21.3, 24a.4**

- [ ] 5.2 Implement lock status updates
  - Implement `markCompleted()` to update status
  - Implement `markFailed()` to update status with error
  - **Validates: Requirements 20, 22**

- [ ] 5.3 Implement duplicate detection
  - Implement `isProcessed()` to check if event_id exists
  - Return true if record exists and status is 'completed'
  - **Validates: Requirements 19, 20, 22**

## Task 6: Knowledge Store Component

- [ ] 6.1 Implement CodeCommit file operations
  - Implement `getLatestCommitId()` using GetBranch API
  - Implement `readFile()` using GetFile API
  - Implement `writeFile()` using CreateCommit API with parent reference
  - **Validates: Requirements 11, 12**

- [ ] 6.2 Implement append-only file operations
  - Implement `appendToFile()` for inbox and receipts
  - Read existing content, append new content, commit
  - Ensure no modification of existing content
  - **Validates: Requirements 13.1, 13.2, 13.3**

- [ ] 6.3 Implement path generation
  - Implement `generateFilePath()` for each classification
  - inbox → `00-inbox/YYYY-MM-DD.md`
  - idea → `10-ideas/<slug>.md`
  - decision → `20-decisions/YYYY-MM-DD-<slug>.md`
  - project → `30-projects/<project-slug>.md`
  - **Validates: Requirements 11.1-11.4, 29.3**

- [ ] 6.4 Implement slug generation
  - Implement `generateSlug()` function
  - Lowercase, hyphen-separated, 3-8 words
  - ASCII characters only, no dates in idea slugs
  - **Validates: Requirements 30.1-30.4**

- [ ] 6.5 Implement commit retry logic
  - Detect parent commit conflicts
  - Retry with updated parent commit reference
  - Maximum 3 retries
  - **Validates: Requirements 12.1, 12.2, 12.3**

## Task 7: Receipt Logger Component

- [ ] 7.1 Implement receipt creation
  - Implement `createReceipt()` with all required fields
  - Include prompt_commit_id and prompt_sha256
  - Format as JSON Lines
  - **Validates: Requirements 15, 16, 36, 45**

- [ ] 7.2 Implement receipt serialization
  - Implement `serializeReceipt()` to JSON string
  - Implement `parseReceipt()` from JSON string
  - Ensure single-line output
  - **Validates: Requirements 15.2, 36**

- [ ] 7.3 Implement receipt appending
  - Implement `appendReceipt()` using append-only pattern
  - Atomic write to `90-receipts/receipts.jsonl`
  - **Validates: Requirements 15.1, 15.3**

- [ ] 7.4 Implement receipt lookup
  - Implement `findReceiptByEventId()` for fix operations
  - Parse receipts.jsonl and search for event_id
  - **Validates: Requirements 10.2, 19.2**

## Task 8: System Prompt Loader Component

- [ ] 8.1 Implement system prompt loading
  - Implement `loadSystemPrompt()` from CodeCommit
  - Read from `/system/agent-system-prompt.md`
  - Cache prompt content and metadata
  - **Validates: Requirements 40.1, 40.2**

- [ ] 8.2 Implement prompt hash computation
  - Implement `computePromptHash()` using SHA-256
  - Store hash in SystemPromptMetadata
  - **Validates: Requirements 45.1, 45.2**

- [ ] 8.3 Implement prompt structure validation
  - Implement `validatePromptStructure()` 
  - Check for required sections (Role, Classification Rules, Output Contract)
  - Fail worker startup if invalid
  - **Validates: Requirements 40.4, 41**

## Task 9: Action Plan Component

- [ ] 9.1 Implement Action Plan JSON schema
  - Define JSON schema for ActionPlan validation
  - Include all required fields per design
  - **Validates: Requirements 42.2-42.5**

- [ ] 9.2 Implement Action Plan validation
  - Implement `validateActionPlan()` against schema
  - Return validation errors array
  - Check classification is valid enum value
  - Check confidence is in [0, 1] range
  - Check file paths match taxonomy
  - **Validates: Requirements 43.1, 43.2**

- [ ] 9.3 Implement LLM output parsing
  - Implement `parseActionPlanFromLLM()` 
  - Extract JSON from LLM response
  - Handle malformed JSON gracefully
  - **Validates: Requirements 42.1**

## Task 10: Action Plan Executor Component

- [ ] 10.1 Implement side effect ordering
  - Execute CodeCommit writes first
  - Execute OmniFocus email second
  - Execute Slack reply third
  - Stop on any failure
  - **Validates: Requirements 44.1, 44.2**

- [ ] 10.2 Implement execution result tracking
  - Track which steps succeeded
  - Track which step failed (if any)
  - Include in receipt
  - **Validates: Requirements 44.3**

- [ ] 10.3 Implement validation failure handling
  - On invalid Action Plan, skip all side effects
  - Send error reply to Slack
  - Create failure receipt with validation_errors
  - **Validates: Requirements 43.2, 43.3, 43.4**

## Task 11: Classifier Component

- [ ] 11.1 Implement Bedrock Agent Runtime integration
  - Configure `@aws-sdk/client-bedrock-agent-runtime` client
  - Use `InvokeAgentCommand` to invoke Bedrock Agent
  - Construct prompt: system prompt (from CodeCommit) + user message
  - Parse Action Plan JSON from streaming response
  - **Validates: Requirements 6.3, 40.2**

- [ ] 11.2 Implement confidence bouncer logic
  - Implement `shouldAskClarification()` 
  - Low confidence (< 0.7) → always clarify
  - Medium confidence (0.7-0.85) → clarify or default to inbox
  - High confidence (≥ 0.85) → proceed
  - **Validates: Requirements 7, 8**

- [ ] 11.3 Implement clarification prompt generation
  - Implement `generateClarificationPrompt()`
  - Include detected classification options
  - Ask exactly one question
  - **Validates: Requirements 7.3, 38.1, 38.2**

## Task 12: Task Router Component

- [ ] 12.1 Implement task email formatting
  - Implement `formatTaskEmail()` 
  - Subject = task title (imperative voice)
  - Body = context + Slack source reference
  - **Validates: Requirements 18, 39**

- [ ] 12.2 Implement SES email sending
  - Implement `sendTaskEmail()` using SES SDK
  - Load OmniFocus Mail Drop address from SSM
  - Return message ID on success
  - **Validates: Requirements 17.1, 17.2**

## Task 13: Slack Responder Component

- [ ] 13.1 Implement confirmation reply formatting
  - Implement `formatConfirmationReply()`
  - Include classification, files changed, commit id
  - Include "reply fix: …" instruction
  - **Validates: Requirements 37.1, 37.2**

- [ ] 13.2 Implement clarification reply formatting
  - Implement `formatClarificationReply()`
  - Include question and valid options
  - **Validates: Requirements 38.1, 38.2, 38.3**

- [ ] 13.3 Implement Slack Web API integration
  - Implement `sendSlackReply()` using chat.postMessage
  - Load bot token from SSM
  - Handle API errors
  - **Validates: Requirements 37, 38**

## Task 14: Conversation Context Component

- [ ] 14.1 Implement DynamoDB conversation store
  - Implement `get()` to retrieve context by channel+user
  - Implement `set()` to store context with TTL
  - Implement `delete()` to clear context
  - **Validates: Requirements 9.1, 9.3**

- [ ] 14.2 Implement context-aware processing
  - Check for existing context on new message
  - Resume processing with original + reply context
  - Clear context after successful processing
  - **Validates: Requirements 9.2**

## Task 15: Fix Handler Component

- [ ] 15.1 Implement fix command parsing
  - Implement `parseFixCommand()` 
  - Match `fix:` prefix (case-insensitive)
  - Extract instruction text
  - **Validates: Requirements 10.1**

- [ ] 15.2 Implement most recent receipt lookup
  - Implement `findMostRecentReceipt()` for user
  - Search receipts.jsonl by user_id
  - Return most recent non-fix receipt
  - **Validates: Requirements 10.2**

- [ ] 15.3 Implement fix application
  - Implement `applyFix()` with AgentCore
  - Create new commit with correction
  - Reference prior commit in receipt
  - **Validates: Requirements 10.3, 10.4**

## Task 16: Markdown Template Generation

- [ ] 16.1 Implement inbox entry template
  - Format with date title
  - Chronological bullet entries with timestamps
  - Include classification hints
  - **Validates: Requirements 32.1-32.3**

- [ ] 16.2 Implement idea note template
  - Format with title, context, key points, implications, open questions, source
  - Keep atomic (one idea per file)
  - **Validates: Requirements 33.1, 33.2**

- [ ] 16.3 Implement decision note template
  - Format with decision statement, date, rationale, alternatives, consequences, source
  - Make decision statement explicit
  - **Validates: Requirements 34.1, 34.2**

- [ ] 16.4 Implement project page template
  - Format with objective, status, key decisions, next steps, references
  - Link to related decision notes
  - **Validates: Requirements 35.1, 35.2**

- [ ] 16.5 Implement Markdown style enforcement
  - Use headings not bold
  - Prefer bullets over prose
  - Use ISO dates
  - No emojis in artifacts
  - Include Source line
  - **Validates: Requirements 31.1-31.5**

## Task 17: Worker Lambda Handler

- [ ] 17.1 Implement Worker Lambda entry point
  - Parse SQS event messages
  - Load system prompt on cold start
  - Wire together all components
  - **Validates: Requirements 3.3, 40.2**

- [ ] 17.2 Implement main processing flow
  - Check idempotency (DynamoDB conditional write)
  - Invoke Bedrock Agent for classification and Action Plan
  - Validate Action Plan against schema
  - Execute side effects in order: CodeCommit → SES → Slack
  - Format and deliver response to Slack (Lambda responsibility)
  - Write receipt to CodeCommit
  - **Validates: Requirements 6, 11, 15, 17, 42-44**

- [ ] 17.3 Implement error handling
  - Handle AgentCore errors with retry
  - Handle CodeCommit conflicts with retry
  - Handle SES errors with user notification
  - Mark idempotency record as failed on error
  - **Validates: Requirements 20, 27**

## Task 18: Observability

- [ ] 18.1 Implement structured logging
  - Log event_id for every processed event
  - Log classification and confidence
  - Log action outcome
  - Log commit_id for successful commits
  - **Validates: Requirements 27.1-27.5**

- [ ] 18.2 Implement PII protection
  - Do not log message content in plain text
  - Do not log email addresses
  - Redact sensitive fields
  - **Validates: Requirement 27.6**

## Task 19: Property-Based Tests

- [ ] 19.1 Write Property 1 test: Signature Verification
  - Generate random bodies, timestamps, secrets
  - Verify correct signatures accepted
  - Verify incorrect signatures rejected
  - **Validates: Requirements 1.1, 1.3**

- [ ] 19.2 Write Property 2 test: Timestamp Validation
  - Generate timestamps within and outside window
  - Verify boundary conditions
  - **Validates: Requirements 1.2, 1.4, 26.1, 26.2**

- [ ] 19.3 Write Property 5 test: Message Filtering
  - Generate events with various channel_type, bot_id, subtype combinations
  - Verify only valid DM events pass
  - **Validates: Requirements 4, 5**

- [ ] 19.4 Write Property 6 test: Classification Type Invariant
  - Verify classification is always one of valid types
  - **Validates: Requirement 6.1**

- [ ] 19.5 Write Property 7 test: Confidence Bounds Invariant
  - Verify confidence is always in [0, 1]
  - **Validates: Requirement 6.2**

- [ ] 19.6 Write Property 11 test: Fix Command Parsing
  - Generate messages with and without fix: prefix
  - Verify correct parsing
  - **Validates: Requirement 10.1**

- [ ] 19.7 Write Property 13 test: Classification to Path Mapping
  - Generate classifications with slugs and dates
  - Verify paths match expected patterns
  - **Validates: Requirements 11, 29.3**

- [ ] 19.8 Write Property 18 test: Receipt Schema Validation
  - Generate receipts with all field combinations
  - Verify schema compliance
  - **Validates: Requirements 16, 36**

- [ ] 19.9 Write Property 21 test: Exactly-Once Semantics
  - Simulate duplicate events
  - Verify at most one commit and email per event_id
  - **Validates: Requirements 19, 20, 22**

- [ ] 19.10 Write Property 22 test: Slug Generation
  - Generate text inputs
  - Verify slugs are lowercase, hyphenated, 3-8 words, ASCII only
  - **Validates: Requirements 30**

## Task 20: Unit Tests

- [ ] 20.1 Write Slack Ingress unit tests
  - Test valid signature verification
  - Test invalid signature rejection
  - Test URL verification challenge response
  - Test event filtering edge cases
  - **Validates: Requirements 1-5**

- [ ] 20.2 Write Idempotency Guard unit tests
  - Test lock acquisition success
  - Test duplicate detection
  - Test TTL calculation
  - **Validates: Requirements 19-22, 24a**

- [ ] 20.3 Write Knowledge Store unit tests
  - Test file path generation for each classification
  - Test append-only enforcement
  - Test commit retry on conflict
  - **Validates: Requirements 11-13, 29, 30**

- [ ] 20.4 Write Receipt Logger unit tests
  - Test receipt creation with all fields
  - Test serialization round-trip
  - Test receipt lookup by event_id
  - **Validates: Requirements 15, 16, 36, 45**

- [ ] 20.5 Write Action Plan unit tests
  - Test valid plan validation
  - Test invalid plan rejection
  - Test LLM output parsing
  - **Validates: Requirements 42, 43**

- [ ] 20.6 Write Template unit tests
  - Test inbox entry format
  - Test idea note format
  - Test decision note format
  - Test project page format
  - **Validates: Requirements 31-35**

## Task 21: Integration Tests

- [ ] 21.1 Write end-to-end DM → Commit flow test
  - Simulate DM event
  - Verify classification
  - Verify CodeCommit commit
  - Verify receipt creation
  - Verify Slack reply
  - **Validates: Requirements 6, 11, 15, 37**

- [ ] 21.2 Write end-to-end DM → Task flow test
  - Simulate task-classified DM
  - Verify OmniFocus email sent
  - Verify receipt creation
  - Verify Slack reply
  - **Validates: Requirements 17, 18, 39**

- [ ] 21.3 Write clarification flow test
  - Simulate low-confidence classification
  - Verify clarification sent
  - Simulate user reply
  - Verify resumed processing
  - **Validates: Requirements 7, 8, 9**

- [ ] 21.4 Write fix flow test
  - Simulate fix: command
  - Verify prior receipt lookup
  - Verify correction commit
  - Verify new receipt references prior
  - **Validates: Requirement 10**

## Task 22: CDK Tests

- [ ] 22.1 Write Ingress Stack snapshot test
  - Verify stack synthesizes without errors
  - Verify resource counts
  - **Validates: Requirement 28**

- [ ] 22.2 Write Core Stack snapshot test
  - Verify stack synthesizes without errors
  - Verify resource counts
  - **Validates: Requirement 28**

- [ ] 22.3 Write IAM permission assertion tests
  - Verify Ingress Lambda has minimal permissions
  - Verify Worker Lambda has required permissions
  - Verify no excessive permissions
  - **Validates: Requirement 25**

## Task 23: System Prompt Artifact

- [ ] 23.1 Create system prompt file
  - Create `/system/agent-system-prompt.md` with all required sections
  - Include Role, Core Responsibilities, Hard Constraints
  - Include Classification Rules, Confidence Bouncer
  - Include Output Contract, Forbidden Behaviors
  - **Validates: Requirements 40, 41**

- [ ] 23.2 Bootstrap CodeCommit repository
  - Create initial commit with system prompt file
  - Create folder structure: `00-inbox/`, `10-ideas/`, `20-decisions/`, `30-projects/`, `90-receipts/`
  - Add `.gitkeep` files to empty folders
  - Document bootstrap process in README
  - **Validates: Requirements 29, 40**

## Task 24: Deployment and Documentation

- [ ] 24.1 Create deployment scripts
  - Create `deploy.sh` for CDK deployment
  - Create `setup-ssm.sh` for parameter setup (manual values)
  - Document deployment order (Ingress → Core)
  - **Validates: Requirement 28**

- [ ] 24.2 Create README with setup instructions
  - Document Slack app configuration
  - Document SSM parameter setup
  - Document SES email verification
  - Document deployment commands
  - **Validates: Requirement 28**

## Task 25: AgentCore Memory Integration

- [ ] 25.1 Implement AgentCore Memory for preferences
  - Store user preferences (confidence thresholds, taxonomy words)
  - Store stable operating assumptions
  - Use AgentCore Memory API for read/write
  - **Validates: Requirements 47.1, 47.2**

- [ ] 25.2 Implement clarification state in AgentCore Memory
  - Store short-lived clarification state
  - Implement TTL-like expiration behavior
  - Clear state after successful processing
  - **Validates: Requirement 47.3**

- [ ] 25.3 Enforce memory strategy constraints
  - Ensure no full notes stored in AgentCore Memory
  - Ensure no receipts stored in AgentCore Memory
  - Ensure no idempotency keys stored in AgentCore Memory
  - **Validates: Requirements 47.4, 47.5, 47.6**

- [ ] 25.4 Write Property 30 test: Git as Source of Truth
  - Verify all durable artifacts stored in Git only
  - Verify Git is authoritative over AgentCore Memory
  - **Validates: Requirements 46.1-46.5**

- [ ] 25.5 Write Property 31 test: AgentCore Memory Constraints
  - Verify only preferences and short-lived state in AgentCore Memory
  - Verify no full notes or receipts in AgentCore Memory
  - **Validates: Requirements 47.1-47.6**
