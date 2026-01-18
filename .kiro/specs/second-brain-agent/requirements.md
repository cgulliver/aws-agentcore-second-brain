# Requirements Document

## Introduction

The Second Brain Agent is a DM-only Slack "front door" system that provides frictionless capture and conversation for personal knowledge management. The system uses Slack as the bidirectional interface, Amazon Bedrock AgentCore for reasoning and orchestration, AWS CodeCommit as the durable knowledge store (Markdown + receipts), and OmniFocus for task execution via Mail Drop email. All infrastructure is provisioned via AWS CDK (TypeScript).

The system prioritizes simplicity, trust, and long-term durability. Slack handles conversation, Git holds memory, OmniFocus handles execution.

## Glossary

- **System**: The Second Brain Agent application
- **Slack_Ingress**: The component that receives and validates Slack webhook requests
- **Classifier**: The component that categorizes user messages using Bedrock AgentCore
- **Knowledge_Store**: The CodeCommit repository storing Markdown files in Johnny.Decimal structure
- **Receipt_Logger**: The component that appends audit entries to the receipts log
- **Task_Router**: The component that sends tasks to OmniFocus via email
- **Idempotency_Guard**: The component that prevents duplicate side effects using event_id and DynamoDB conditional writes
- **Johnny_Decimal**: A file organization system using numeric prefixes (00-99) for stable navigation
- **Mail_Drop**: OmniFocus email-based task capture feature
- **Event_Callback**: A Slack webhook payload containing a user message event; DM events have `channel_type: "im"` at the event level
- **Confidence_Threshold**: The minimum classification confidence required for autonomous action
- **Lambda_Function_URL**: A public HTTPS endpoint for Lambda with application-layer authentication
- **System_Prompt**: The committed Markdown file that defines agent behavior and classification rules
- **Action_Plan**: The structured output from AgentCore that specifies all intended side effects
- **Action_Plan_Validator**: The component that validates Action Plans against a strict schema before execution

## Requirements

### Requirement 1: Slack Request Verification

**User Story:** As a system operator, I want all incoming Slack requests to be cryptographically verified, so that the system only processes authentic requests.

#### Acceptance Criteria

1. WHEN Slack sends any request to the System, THE Slack_Ingress SHALL verify the Slack signing signature using the configured signing secret
2. WHEN Slack sends any request to the System, THE Slack_Ingress SHALL verify the request timestamp is within an acceptable window (5 minutes)
3. IF the signature verification fails, THEN THE Slack_Ingress SHALL reject the request with HTTP 401
4. IF the timestamp is outside the acceptable window, THEN THE Slack_Ingress SHALL reject the request with HTTP 401

### Requirement 2: Slack URL Verification

**User Story:** As a system operator, I want the system to respond to Slack's URL verification challenge, so that Slack can confirm the endpoint is valid.

#### Acceptance Criteria

1. WHEN Slack sends a `url_verification` request, THE Slack_Ingress SHALL respond with the provided `challenge` value
2. WHEN Slack sends a `url_verification` request, THE Slack_Ingress SHALL respond with HTTP 200 and content-type `text/plain`

### Requirement 3: Fast Acknowledgement and Async Processing

**User Story:** As a system operator, I want Slack events to be acknowledged quickly and processed asynchronously, so that Slack does not retry due to timeout.

#### Acceptance Criteria

1. WHEN Slack sends an `event_callback`, THE Slack_Ingress SHALL acknowledge with HTTP 200 within 3 seconds
2. WHEN Slack sends an `event_callback`, THE Slack_Ingress SHALL enqueue the event for asynchronous processing
3. THE System SHALL process enqueued events independently of the acknowledgement response

### Requirement 4: DM-Only Scope

**User Story:** As a user, I want the system to only respond to direct messages, so that my private captures remain private.

#### Acceptance Criteria

1. WHEN an event type is `message.im` (direct message), THE System SHALL process the event
2. WHEN an event type is not `message.im`, THE System SHALL ignore the event without error
3. THE System SHALL NOT process events from channels, groups, or app mentions

### Requirement 5: Bot and Edit Filtering

**User Story:** As a user, I want the system to ignore bot messages and edits, so that only my original messages are captured.

#### Acceptance Criteria

1. WHEN an event has a `bot_id` field, THE System SHALL ignore the event
2. WHEN an event has a `subtype` field (edit, delete, etc.), THE System SHALL ignore the event
3. THE System SHALL only process original human-authored messages

### Requirement 6: Message Classification

**User Story:** As a user, I want my messages to be automatically classified, so that they are routed to the correct destination.

#### Acceptance Criteria

1. WHEN a user message is processed, THE Classifier SHALL classify it as exactly one of: `inbox`, `idea`, `decision`, `project`, `task`
2. WHEN classifying a message, THE Classifier SHALL produce a confidence score between 0.0 and 1.0
3. THE Classifier SHALL use Bedrock AgentCore for LLM-based classification

### Requirement 7: Confidence Bouncer

**User Story:** As a user, I want the system to ask for clarification when uncertain, so that my knowledge is accurately categorized.

#### Acceptance Criteria

1. WHEN classification confidence is below the configured threshold, THE System SHALL ask exactly one clarifying question via Slack DM
2. WHEN classification confidence is below the configured threshold, THE System SHALL NOT perform any side effects (no commits, no emails)
3. WHEN asking for clarification, THE System SHALL include the detected classification options in the question

### Requirement 8: Safe Fallback

**User Story:** As a user, I want ambiguous messages to default to inbox, so that nothing is lost.

#### Acceptance Criteria

1. IF classification is ambiguous and confidence is medium (between low threshold and high threshold), THEN THE System SHALL either ask a clarifying question or default to `inbox`
2. WHEN defaulting to `inbox`, THE System SHALL inform the user of the fallback via Slack reply

### Requirement 9: Clarification Loop

**User Story:** As a user, I want to answer clarifying questions and have my response processed in context, so that the conversation flows naturally.

#### Acceptance Criteria

1. WHEN clarification is required, THE System SHALL store the conversation context
2. WHEN the user replies to a clarification question, THE System SHALL resume processing with the original message and clarification response
3. THE System SHALL maintain conversation context for a configurable timeout period
4. THE conversation context records SHALL include a TTL attribute
5. THE default conversation context TTL SHALL be 3600 seconds (1 hour)
6. THE conversation context TTL SHALL be configurable via SSM Parameter Store
7. THE conversation context TTL SHALL NOT be hardcoded

### Requirement 10: Fix Protocol

**User Story:** As a user, I want to correct mistakes by replying with "fix:", so that I can easily amend previous actions.

#### Acceptance Criteria

1. WHEN the user sends a message starting with `fix:`, THE System SHALL interpret it as a correction request
2. WHEN processing a fix request, THE System SHALL identify the most recent action to correct
3. WHEN a fix is applied, THE System SHALL create a new commit with the correction
4. WHEN a fix is applied, THE Receipt_Logger SHALL append a new receipt referencing the prior action's receipt

### Requirement 11: Durable Knowledge Storage

**User Story:** As a user, I want my knowledge stored as Markdown in Git, so that it is durable and auditable.

#### Acceptance Criteria

1. WHEN classification is `inbox`, THE Knowledge_Store SHALL append content to `00-inbox/YYYY-MM-DD.md`
2. WHEN classification is `idea`, THE Knowledge_Store SHALL write content to `10-ideas/<slug>.md`
3. WHEN classification is `decision`, THE Knowledge_Store SHALL write content to `20-decisions/YYYY-MM-DD-<slug>.md`
4. WHEN classification is `project`, THE Knowledge_Store SHALL write content to `30-projects/<project-slug>.md`
5. THE Knowledge_Store SHALL create a CodeCommit commit for each write operation

### Requirement 12: Commit Integrity

**User Story:** As a system operator, I want commits to always reference their parent, so that concurrent changes are not overwritten.

#### Acceptance Criteria

1. WHEN creating a commit, THE Knowledge_Store SHALL include the parent commit reference
2. IF the parent commit has changed since reading, THEN THE Knowledge_Store SHALL retry with the new parent
3. THE Knowledge_Store SHALL use optimistic locking to prevent lost updates

### Requirement 13: Append-Only Rules

**User Story:** As a user, I want inbox and receipts to be append-only, so that historical data is preserved.

#### Acceptance Criteria

1. THE Knowledge_Store SHALL treat `00-inbox/*.md` files as append-only
2. THE Receipt_Logger SHALL treat `90-receipts/receipts.jsonl` as append-only
3. WHEN writing to append-only files, THE System SHALL only add content to the end of the file

### Requirement 14: Destructive Change Guard

**User Story:** As a user, I want to confirm destructive changes, so that I don't accidentally lose data.

#### Acceptance Criteria

1. IF a proposed change deletes content from an existing file, THEN THE System SHALL request explicit confirmation via Slack
2. IF a proposed change rewrites more than 30% of an existing file, THEN THE System SHALL request explicit confirmation via Slack
3. WHEN confirmation is denied, THE System SHALL abort the change and inform the user

### Requirement 15: Receipt Creation

**User Story:** As a system operator, I want every action to create a receipt, so that all operations are auditable.

#### Acceptance Criteria

1. WHEN any action is taken (commit, task creation, clarification), THE Receipt_Logger SHALL append exactly one receipt entry to `90-receipts/receipts.jsonl`
2. THE Receipt_Logger SHALL write receipts as JSON Lines format (one JSON object per line)
3. THE Receipt_Logger SHALL ensure receipt writes are atomic

### Requirement 16: Receipt Contents

**User Story:** As a system operator, I want receipts to contain comprehensive metadata, so that I can audit and debug the system.

#### Acceptance Criteria

1. THE Receipt_Logger SHALL include timestamp in ISO 8601 format in each receipt
2. THE Receipt_Logger SHALL include Slack event_id, user_id, and channel_id in each receipt
3. THE Receipt_Logger SHALL include classification type and confidence score in each receipt
4. THE Receipt_Logger SHALL include action taken (commit, task, clarification, fix) in each receipt
5. THE Receipt_Logger SHALL include affected file paths and commit_id when applicable
6. THE Receipt_Logger SHALL include external side effects (e.g., OmniFocus email sent) in each receipt

### Requirement 17: Task Creation

**User Story:** As a user, I want tasks to be sent to OmniFocus, so that I can track and execute them.

#### Acceptance Criteria

1. WHEN classification is `task` and confidence is above threshold, THE Task_Router SHALL send an email to the OmniFocus Mail Drop address
2. THE Task_Router SHALL use AWS SES to send the email
3. WHEN a task email is sent, THE Receipt_Logger SHALL record the email send in the receipt

### Requirement 18: Task Semantics

**User Story:** As a user, I want task emails to be properly formatted, so that OmniFocus captures them correctly.

#### Acceptance Criteria

1. THE Task_Router SHALL map the task title to the email subject line
2. THE Task_Router SHALL map the task context/notes to the email body
3. THE Task_Router SHALL include a reference to the Slack message in the email body

### Requirement 19: No Task Duplication

**User Story:** As a user, I want each task to be created only once, so that I don't have duplicate tasks in OmniFocus.

#### Acceptance Criteria

1. WHEN Slack retries an event, THE Idempotency_Guard SHALL prevent duplicate OmniFocus task emails
2. THE Idempotency_Guard SHALL check for existing receipts with the same event_id before sending task emails

### Requirement 20: At-Least-Once Handling

**User Story:** As a system operator, I want the system to handle Slack's at-least-once delivery, so that events are processed reliably.

#### Acceptance Criteria

1. THE System SHALL treat all Slack events as potentially delivered multiple times
2. THE System SHALL not fail or error when receiving duplicate events
3. THE System SHALL process each unique event exactly once

### Requirement 21: Idempotency Key

**User Story:** As a system operator, I want event_id to be the idempotency key, so that duplicate detection is reliable.

#### Acceptance Criteria

1. THE Idempotency_Guard SHALL use Slack `event_id` as the unique identifier for each event
2. THE Idempotency_Guard SHALL store processed event_ids in DynamoDB with conditional writes
3. THE Idempotency_Guard SHALL use DynamoDB TTL to expire records after 7 days
4. THE Idempotency_Guard SHALL check event_id before performing any side effects

### Requirement 22: Exactly-Once Effects

**User Story:** As a system operator, I want each event to produce at most one commit and one email, so that the system is predictable.

#### Acceptance Criteria

1. THE Idempotency_Guard SHALL ensure each `event_id` produces at most one CodeCommit commit
2. THE Idempotency_Guard SHALL ensure each `event_id` produces at most one OmniFocus email
3. WHEN a duplicate event is detected, THE System SHALL return success without performing side effects

### Requirement 23: Parameter Store Usage

**User Story:** As a system operator, I want secrets stored in SSM Parameter Store, so that they are secure and manageable.

#### Acceptance Criteria

1. THE System SHALL load the Slack signing secret from SSM Parameter Store (SecureString)
2. THE System SHALL load the Slack bot token from SSM Parameter Store (SecureString)
3. THE System SHALL load the OmniFocus Mail Drop email address from SSM Parameter Store (SecureString)
4. THE System SHALL NOT hardcode any secrets in code or configuration files

### Requirement 24: No Secrets Manager

**User Story:** As a system operator, I want to use only Parameter Store in v1, so that the system remains simple.

#### Acceptance Criteria

1. THE System SHALL NOT use AWS Secrets Manager in v1
2. THE System MAY introduce Secrets Manager in future versions if automated rotation is required

### Requirement 24a: DynamoDB for Idempotency

**User Story:** As a system operator, I want idempotency state stored in DynamoDB, so that exactly-once semantics are guaranteed.

#### Acceptance Criteria

1. THE System SHALL use a DynamoDB table for idempotency tracking
2. THE DynamoDB table SHALL be keyed by Slack `event_id`
3. THE DynamoDB table SHALL use TTL to automatically expire records after 7 days
4. THE System SHALL use DynamoDB conditional writes to prevent race conditions
5. THE System SHALL NOT use DynamoDB for knowledge storage (CodeCommit only)

### Requirement 25: Least Privilege IAM

**User Story:** As a system operator, I want minimal IAM permissions, so that the blast radius of any compromise is limited.

#### Acceptance Criteria

1. THE Slack_Ingress component SHALL only have permissions to verify signatures and enqueue events to SQS
2. THE worker component SHALL have permissions to invoke Bedrock AgentCore, write to CodeCommit, send email via SES, and post to Slack
3. THE System SHALL NOT grant any component more permissions than required for its function

### Requirement 26: Replay Protection

**User Story:** As a system operator, I want old requests rejected, so that replay attacks are prevented.

#### Acceptance Criteria

1. THE Slack_Ingress SHALL reject requests with timestamps older than 5 minutes
2. THE Slack_Ingress SHALL reject requests with timestamps in the future (beyond reasonable clock skew)

### Requirement 27: Observability

**User Story:** As a system operator, I want comprehensive logging, so that I can monitor and debug the system.

#### Acceptance Criteria

1. THE System SHALL log the Slack event_id for every processed event
2. THE System SHALL log the classification type and confidence score
3. THE System SHALL log the action outcome (success, failure, clarification requested)
4. THE System SHALL log the commit_id for successful commits
5. THE System SHALL log the email send result without logging sensitive content
6. THE System SHALL NOT log message content or PII in plain text

### Requirement 28: CDK Infrastructure

**User Story:** As a system operator, I want all infrastructure defined in CDK, so that deployment is repeatable and auditable.

#### Acceptance Criteria

1. THE System SHALL define all AWS resources using AWS CDK (TypeScript)
2. THE System SHALL be deployable via CDK deploy commands
3. THE CDK SHALL be organized into two stacks: Ingress Stack and Core Stack
4. THE Ingress Stack SHALL include: Ingress Lambda, API Gateway HTTP API, Custom Domain, Route 53 DNS Record, SQS Queue, SQS DLQ
5. THE Core Stack SHALL include: Worker Lambda, CodeCommit Repository, DynamoDB Table, SES Email Identity, IAM roles
6. THE System SHALL use API Gateway HTTP API with custom domain for the Slack webhook endpoint (Lambda Function URLs prohibited per security policy)
7. THE API Gateway default execute-api endpoint SHALL be disabled
8. THE custom domain, hosted zone ID, and ACM certificate ARN SHALL be loaded from SSM Parameter Store (not hardcoded)

### Requirement 28a: Security Delta - API Gateway Ingress

**User Story:** As a security officer, I want all externally reachable endpoints to traverse API Gateway with custom domain, so that security policy is satisfied.

#### Acceptance Criteria

1. THE System SHALL NOT use Lambda Function URLs for Slack ingress (auth=NONE prohibited)
2. THE Slack ingress SHALL use Amazon API Gateway HTTP API with custom domain
3. THE API Gateway default execute-api endpoint SHALL be disabled
4. THE custom domain SHALL use an existing ACM certificate (imported by ARN from SSM)
5. THE System SHALL create a Route 53 Alias A record pointing to the API Gateway custom domain
6. THE domain name, hosted zone ID, and ACM certificate ARN SHALL be provided via SSM Parameter Store
7. THE repository SHALL NOT contain hardcoded domain names, hosted zone IDs, or certificate ARNs


### Requirement 29: Repository Structure

**User Story:** As a user, I want a consistent folder structure, so that my knowledge is organized and navigable.

#### Acceptance Criteria

1. THE Knowledge_Store SHALL include exactly these top-level folders: `00-inbox/`, `10-ideas/`, `20-decisions/`, `30-projects/`, `90-receipts/`
2. THE Knowledge_Store SHALL NOT create additional top-level folders in v1
3. THE System SHALL map classifications to paths deterministically: inbox→`00-inbox/YYYY-MM-DD.md`, idea→`10-ideas/<slug>.md`, decision→`20-decisions/YYYY-MM-DD-<slug>.md`, project→`30-projects/<project-slug>.md`

### Requirement 30: Slug Generation

**User Story:** As a user, I want consistent file naming, so that files are easy to find and reference.

#### Acceptance Criteria

1. THE System SHALL generate slugs that are lowercase and hyphen-separated
2. THE System SHALL generate slugs that are 3-8 words in length
3. THE System SHALL generate slugs using ASCII characters only
4. THE System SHALL NOT include dates in idea slugs (dates are reserved for decisions)

### Requirement 31: Markdown Style

**User Story:** As a user, I want consistent Markdown formatting, so that my knowledge is readable and parseable.

#### Acceptance Criteria

1. THE System SHALL use headings (`#`, `##`, `###`) rather than heavy bold formatting
2. THE System SHALL prefer bullets over long prose
3. THE System SHALL use ISO dates (`YYYY-MM-DD`) in all date references
4. THE System SHALL NOT include emojis within stored artifacts
5. THE System SHALL include a "Source" line linking context back to Slack (channel + timestamp)

### Requirement 32: Inbox Template

**User Story:** As a user, I want inbox entries to follow a consistent format, so that daily captures are organized.

#### Acceptance Criteria

1. THE System SHALL format inbox files with a title containing the date
2. THE System SHALL format inbox entries as chronological bullet entries with timestamps
3. THE System SHALL include classification hints in inbox entries when known

### Requirement 33: Idea Note Template

**User Story:** As a user, I want idea notes to be atomic and structured, so that they capture complete thoughts.

#### Acceptance Criteria

1. THE System SHALL format idea notes with: short title, context, key points, implications, open questions, and source
2. THE System SHALL keep idea notes atomic (one idea per file)

### Requirement 34: Decision Note Template

**User Story:** As a user, I want decision notes to capture rationale, so that I can understand past decisions.

#### Acceptance Criteria

1. THE System SHALL format decision notes with: decision statement, date, rationale, alternatives considered, consequences, and source
2. THE System SHALL make the decision statement explicit and clear

### Requirement 35: Project Page Template

**User Story:** As a user, I want project pages to track status and decisions, so that I can manage ongoing work.

#### Acceptance Criteria

1. THE System SHALL format project pages with: objective, current status, key decisions (with links), next steps, and references
2. THE System SHALL link to related decision notes from project pages

### Requirement 36: Receipt Schema

**User Story:** As a system operator, I want a consistent receipt schema, so that auditing is reliable.

#### Acceptance Criteria

1. THE Receipt_Logger SHALL include `timestamp_iso` (ISO 8601 string) in each receipt
2. THE Receipt_Logger SHALL include `event_id` (Slack event id string) in each receipt
3. THE Receipt_Logger SHALL include `slack` object with `user_id`, `channel_id`, and `message_ts` in each receipt
4. THE Receipt_Logger SHALL include `classification` (enum: inbox|idea|decision|project|task|fix|clarify) in each receipt
5. THE Receipt_Logger SHALL include `confidence` (number 0-1) in each receipt
6. THE Receipt_Logger SHALL include `actions` array describing side effects (type and details) in each receipt
7. THE Receipt_Logger SHALL include `files` array (paths affected) in each receipt
8. THE Receipt_Logger SHALL include `commit_id` (string or null) in each receipt
9. THE Receipt_Logger SHALL include `summary` (human-readable string) in each receipt

### Requirement 37: Slack Confirmation Reply

**User Story:** As a user, I want confirmation of actions, so that I know what the system did.

#### Acceptance Criteria

1. WHEN an action is successful, THE System SHALL reply in Slack with: classification, files changed, commit id (if any)
2. WHEN an action is successful, THE System SHALL include instruction to "reply fix: …" for corrections
3. THE System SHALL NOT use emojis in Slack replies stored as artifacts (emojis allowed in transient Slack messages)

### Requirement 38: Clarification Prompt Format

**User Story:** As a user, I want clear clarification prompts, so that I can quickly respond.

#### Acceptance Criteria

1. WHEN asking for clarification, THE System SHALL ask exactly one question
2. WHEN asking for clarification, THE System SHALL enumerate valid response options
3. THE System SHALL support `reclassify: <type>` command to change classification

### Requirement 39: OmniFocus Email Format

**User Story:** As a user, I want properly formatted task emails, so that OmniFocus captures them correctly.

#### Acceptance Criteria

1. THE Task_Router SHALL format email subject as task title (imperative voice)
2. THE Task_Router SHALL format email body with: context, optional repo links, and source reference
3. THE Task_Router SHALL include Slack channel and timestamp in the source reference

### Requirement 40: System Prompt File

**User Story:** As a system operator, I want the agent's behavior defined in a committed file, so that behavior changes are versioned and auditable.

#### Acceptance Criteria

1. THE System SHALL store the agent system prompt at `/system/agent-system-prompt.md` in the CodeCommit repository
2. THE System SHALL load the system prompt from the committed file when invoking Bedrock AgentCore
3. THE System SHALL NOT store system prompt content in SSM Parameter Store
4. THE CDK deployment SHALL bootstrap a placeholder system prompt if none is present at first deploy
5. IF the system prompt cannot be loaded at runtime, THEN THE worker SHALL fall back to a minimal safe prompt
6. IF the system prompt cannot be loaded at runtime, THEN THE worker SHALL emit error-level logs and metrics

### Requirement 41: System Prompt Contents

**User Story:** As a system operator, I want the system prompt to define all agent behavior rules, so that the agent acts consistently and predictably.

#### Acceptance Criteria

1. THE System_Prompt SHALL define the agent's role as a private, single-user Second Brain agent
2. THE System_Prompt SHALL define classification rules mapping signals to exactly one of: `inbox`, `idea`, `decision`, `project`, `task`
3. THE System_Prompt SHALL define confidence thresholds (high ≥ 0.85, medium 0.7–0.84, low < 0.7)
4. THE System_Prompt SHALL define the Action Plan output contract schema
5. THE System_Prompt SHALL define forbidden behaviors (no hallucinated paths, no multi-classification, no speculative commits)
6. THE System_Prompt SHALL define the fix and repair protocol

### Requirement 42: Action Plan Output Contract

**User Story:** As a system operator, I want the agent to output a structured Action Plan, so that side effects are predictable and validatable.

#### Acceptance Criteria

1. THE Classifier SHALL output an Action Plan object for every classification
2. THE Action Plan SHALL include: classification, confidence, needs_clarification (boolean), clarification_prompt (if applicable)
3. THE Action Plan SHALL include: file_operations (array of paths and operation types), commit_message
4. THE Action Plan SHALL include: omnifocus_email (optional object with subject and body), slack_reply_text
5. THE Action Plan SHALL NOT include any fields not defined in the schema

### Requirement 43: Action Plan Validation

**User Story:** As a system operator, I want Action Plans validated before execution, so that invalid plans do not cause side effects.

#### Acceptance Criteria

1. THE Action_Plan_Validator SHALL validate every Action Plan against a strict JSON schema before execution
2. IF the Action Plan is invalid, THEN THE System SHALL NOT perform any side effects
3. IF the Action Plan is invalid, THEN THE System SHALL reply to Slack with an error message
4. IF the Action Plan is invalid, THEN THE Receipt_Logger SHALL append a receipt noting the validation failure

### Requirement 44: Side Effect Ordering

**User Story:** As a system operator, I want side effects executed in a specific order, so that failures are handled predictably.

#### Acceptance Criteria

1. WHEN multiple side effects are required, THE System SHALL execute them in this order: CodeCommit writes, OmniFocus email, Slack reply
2. IF any side effect fails, THEN THE System SHALL NOT execute subsequent side effects
3. THE Receipt_Logger SHALL record which side effects succeeded and which failed

### Requirement 44a: Execution State Tracking

**User Story:** As a system operator, I want execution state persisted, so that partial failures can be recovered.

#### Acceptance Criteria

1. THE worker SHALL persist an execution record keyed by `event_id`
2. THE execution record SHALL include `status` with values: `RECEIVED`, `PLANNED`, `EXECUTING`, `PARTIAL_FAILURE`, `SUCCEEDED`, `FAILED_PERMANENT`
3. THE execution record SHALL include per-step status (e.g., `codecommit_status`, `ses_status`, `slack_status`)
4. THE execution record SHALL include `last_error` and `updated_at` fields
5. THE execution record MAY include `retry_after` for retry scheduling

### Requirement 44b: Partial Failure Handling

**User Story:** As a system operator, I want partial failures to be recoverable, so that successful side effects are not repeated.

#### Acceptance Criteria

1. IF an execution fails after one or more side effects succeed, THEN THE execution record SHALL be marked `PARTIAL_FAILURE`
2. WHEN retrying a `PARTIAL_FAILURE` execution, THE System SHALL NOT re-execute successfully completed side effects
3. WHEN retrying a `PARTIAL_FAILURE` execution, THE System SHALL resume at the first failed step

### Requirement 44c: Retry Semantics

**User Story:** As a system operator, I want safe retries for partial failures, so that transient errors can be recovered.

#### Acceptance Criteria

1. THE System SHALL support safe retries for executions in `PARTIAL_FAILURE` status
2. Retries MAY be automatic (queue-based) or user-initiated
3. ON retry, execution SHALL resume at the first failed step
4. THE System SHALL NOT create duplicate side effects on retry

### Requirement 45: Receipt Prompt Metadata

**User Story:** As a system operator, I want receipts to include prompt version information, so that I can trace behavior to exact prompt versions.

#### Acceptance Criteria

1. THE Receipt_Logger SHALL include `prompt_commit_id` (the commit id of the system prompt file) in each receipt
2. THE Receipt_Logger SHALL include `prompt_sha256` (SHA-256 hash of the system prompt content) in each receipt
3. THE System SHALL compute prompt metadata at worker startup and include it in all receipts for that invocation

### Requirement 46: Memory Strategy — Git as Source of Truth

**User Story:** As a user, I want Git to be the canonical source of truth for all knowledge, so that my second brain is durable and auditable.

#### Acceptance Criteria

1. THE System SHALL store all durable knowledge (inbox, ideas, decisions, projects) in CodeCommit only
2. THE System SHALL store all receipts in CodeCommit only
3. THE System SHALL store the system prompt in CodeCommit only
4. IF a fact exists in both AgentCore Memory and Git and they conflict, THEN Git SHALL be authoritative
5. THE System SHALL NOT rely on AgentCore Memory to rebuild the repository

### Requirement 47: AgentCore Memory — Behavioral Context Only

**User Story:** As a user, I want AgentCore Memory to store preferences and behavioral context, so that interactions improve over time without polluting my knowledge base.

#### Acceptance Criteria

1. THE System MAY store user preferences in AgentCore Memory (confidence thresholds, taxonomy preferences, Markdown style)
2. THE System MAY store stable operating assumptions in AgentCore Memory ("tasks go to OmniFocus", "AI-only commits")
3. THE System MAY store short-lived clarification state in AgentCore Memory with TTL-like behavior
4. THE System SHALL NOT store full notes, decisions, or project documents in AgentCore Memory
5. THE System SHALL NOT store receipts or idempotency keys in AgentCore Memory
6. THE System SHALL NOT store anything that must be exactly reconstructable in AgentCore Memory

### Requirement 48: Slack Retry Handling

**User Story:** As a system operator, I want the system to handle Slack's retry behavior gracefully, so that duplicate deliveries do not cause duplicate side effects.

#### Acceptance Criteria

1. THE System SHALL assume Slack may retry delivery up to 3 times with exponential backoff
2. THE System SHALL return HTTP 200 within 3 seconds to prevent unnecessary retries
3. THE Idempotency_Guard SHALL ensure side effects are executed at most once regardless of retry count
4. THE System SHALL NOT fail or produce errors when receiving retried events

### Requirement 49: Slack OAuth Scopes

**User Story:** As a system operator, I want the Slack app to request only the necessary OAuth scopes, so that the system follows least-privilege principles.

#### Acceptance Criteria

1. THE Slack app SHALL request the `im:history` scope to read DM history
2. THE Slack app SHALL request the `im:read` scope to view DM metadata
3. THE Slack app SHALL request the `chat:write` scope to send messages
4. THE System SHALL NOT request scopes beyond what is required for v1 functionality
5. IF additional interactions are introduced (buttons, modals, channel mentions), THEN scopes SHALL be revisited and expanded accordingly

### Requirement 50: Rate Limiting and Throttling

**User Story:** As a system operator, I want the system to handle rate limits gracefully, so that transient throttling does not cause permanent failures.

#### Acceptance Criteria

1. ON Slack API `429` responses, THE worker SHALL honor the `Retry-After` header
2. ON Slack API throttling, THE worker SHALL retry with bounded exponential backoff
3. IF Slack retry window is exceeded, THEN THE execution SHALL be marked `PARTIAL_FAILURE` or `FAILED` as appropriate
4. ON SES throttling or transient send failures, THE worker SHALL retry with exponential backoff up to a configurable maximum
5. IF SES retries are exhausted and prior steps succeeded, THEN THE execution SHALL be marked `PARTIAL_FAILURE`
6. ON AgentCore Runtime throttling or transient invocation errors, THE worker SHALL retry planning with bounded exponential backoff
7. IF AgentCore retries are exhausted, THEN THE execution SHALL be marked `FAILED` and no side effects SHALL be executed

### Requirement 51: Concurrency and Backpressure

**User Story:** As a system operator, I want concurrency limits configurable, so that the system can be tuned for load.

#### Acceptance Criteria

1. Concurrency limits SHALL be configurable (e.g., Lambda reserved concurrency, SQS settings)
2. THE System SHALL prefer queueing over rejecting Slack events
3. THE System SHALL NOT drop events due to temporary capacity constraints

### Requirement 52: SES Production Prerequisites

**User Story:** As a system operator, I want clear SES production requirements documented, so that deployment is successful.

#### Acceptance Criteria

1. Deployment documentation SHALL explicitly state SES production prerequisites
2. THE documentation SHALL specify verified sending identity requirements (domain or address)
3. THE documentation SHALL specify sandbox exit requirements if applicable
4. Non-production environments SHALL support a log-only or no-op email mode via configuration
