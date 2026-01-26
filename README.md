# AWS AgentCore Second Brain

> A personal knowledge capture system that turns Slack DMs into organized notes, decisions, and tasks.

[![Tests](https://img.shields.io/badge/tests-478%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)]()
[![AWS CDK](https://img.shields.io/badge/AWS%20CDK-2.x-orange)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## Why Second Brain?

Ideas happen everywhere - in meetings, on walks, in the shower. The friction of opening an app, choosing a folder, and formatting a note means most thoughts never get captured. Second Brain removes that friction entirely.

Send a message to your Slack bot, and it automatically:
- **Classifies** your thought (inbox, idea, decision, project, or task)
- **Stores** it in a Git repository as Markdown
- **Routes** tasks to your task manager via email
- **Confirms** what it did

No apps to open. No forms to fill. Just message your bot.

## Philosophy

This system separates **knowledge** from **execution** by design:

| Knowledge Store (Git) | Execution Layer (Task Manager) |
|-----------------------|-------------------------------|
| Notes, specs, decisions, artifacts | Tasks, due dates, priorities |
| Projects as context and goals | Projects as task containers |
| Versioned, diffable, long-lived | Optimized for "what to do next" |
| Source of truth for understanding | Considered disposable, re-creatable |

These layers connect through a single canonical identifier (**SB_ID**) which provides continuity without coupling. Execution state doesn't live in Git. Knowledge artifacts don't depend on task state. Tasks reference knowledge projects via SB_ID for context, but the two project concepts remain independent.

**What this repository is:**
- A memory and knowledge store
- A source of truth for decisions and artifacts
- A stable anchor for cross-tool linking

**What this repository is not:**
- A task manager
- A priority engine
- A personal workflow enforcer

**Design mantra:** *Capture now. Link reliably. Decide intentionally.*

## Principles

- **Neutral Capture** - Items captured without premature classification (e.g., work vs personal); human judgment applied during review, not at capture time
- **One Canonical ID** - Each durable item gets an immutable SB_ID used consistently across the repository and execution tools
- **Durable Knowledge** - Notes, specs, and decisions live in Git and evolve over time
- **Execution Isolation** - Task management concerns remain outside the repository
- **Minimal Automation** - The system handles plumbing and consistency, not meaning
- **Plain Text** - Markdown files in Git, not locked in a proprietary database
- **Own Your Data** - Everything lives in your AWS account, clone it anytime
- **Serverless** - Pay only for what you use, scales to zero when idle

## How It Fits Together

- Inbound messages from Slack create or reference items identified by SB_ID
- Durable artifacts are written to the knowledge repository with minimal frontmatter and stable filenames
- Execution tasks reference SB_IDs to maintain continuity, but execution state is not mirrored back into the repo
- Multiple clones of the repository (Working Copy, Obsidian, local machines) are expected; automation writes are append-only to avoid conflicts

### Completion and Status

Task completion lives in your task manager (OmniFocus), not in the knowledge repo. When you complete a task in OmniFocus, the knowledge repo doesn't change - and that's intentional.

For projects in the knowledge repo, update status via Slack:
- "Project update: Kitchen renovation is complete"
- "Decision: closing the home automation project - achieved the goals"
- The repo tracks *what you thought and decided*, not *what got done*

**Single writer model:** All repo updates flow through Slack. Obsidian and other git clients are read-only viewers. This avoids merge conflicts and keeps the automation as the single source of writes. If you need to edit something, use the `fix:` command or send a new message.

This separation means you can rebuild your task manager from scratch without losing knowledge, and your knowledge base stays clean of transient execution state.

## Demo

```
You: I've decided to use PostgreSQL for the new project because of 
     better JSON support and our team's familiarity with it.

Bot: Captured as decision
     Files: 20-decisions/2024-01-15__use-postgresql__sb-a1b2c3d.md
     Commit: a1b2c3d
     
     Reply "fix: <instruction>" to correct.
```

## How It Works

```
┌─────────────┐                              ┌─────────────┐
│             │      "I decided to use       │             │
│    You      │       PostgreSQL for the  ─▶ │  Second     │
│             │       new project"           │   Brain     │
└─────────────┘                              └──────┬──────┘
                                                    │
                     ┌──────────────────────────────┼──────────────────────────────┐
                     │                              ▼                              │
                     │  ┌────────────┐    ┌────────────────┐    ┌────────────┐     │
                     │  │  Classify  │───▶│  Store & Link  │───▶│   Reply    │     │
                     │  │            │    │                │    │            │     │
                     │  │ "decision" │    │ Git + Memory   │    │ "Captured" │     │
                     │  └────────────┘    └───────┬────────┘    └────────────┘     │
                     │                            │                                │
                     │                            ▼                                │
                     │                   ┌────────────────┐                        │
                     │                   │  Your Notes    │                        │
                     │                   │  (Obsidian)    │                        │
                     │                   └────────────────┘                        │
                     └─────────────────────────────────────────────────────────────┘
```

### Technical Architecture

```
┌─────────────┐      ┌──────────────────────────────────────────────────────┐
│   Slack     │      │                         AWS                          │
│             │      │                                                      │
│  ┌───────┐  │      │  ┌─────────┐  ┌─────────┐  ┌─────────┐               │
│  │  DM   │──┼─────▶│  │ API GW  │─▶│ Ingress │─▶│   SQS   │               │
│  └───────┘  │      │  │ (mTLS)  │  │ Lambda  │  └────┬────┘               │
│      ▲      │      │  └─────────┘  └─────────┘       │                    │
│      │      │      │                                 ▼                    │
│      │      │      │  ┌─────────────────────────────────────────────┐     │
│      │      │      │  │              Worker Lambda                  │     │
│      │      │      │  │                                             │     │
│      │      │      │  │   ┌──────────┐           ┌─────────┐        │     │
│  ┌───┴───┐  │      │  │   │ DynamoDB │           │   SES   │────────┼─────┼──▶ OmniFocus
│  │ Reply │◀─┼──────┼──┤   │ (state)  │           │ (tasks) │        │     │    (Mail Drop)
│  └───────┘  │      │  │   └──────────┘           └─────────┘        │     │
└─────────────┘      │  │                                             │     │
                     │  └──────────────────────┬──────────────────────┘     │
                     │                         │                            │
                     │                         │ invoke / response          │
                     │                         │ commit                     │
                     │                         ▼                            │
                     │  ┌─────────────────────────────────────────────┐     │
                     │  │        AgentCore Runtime (classifier)       │     │
                     │  │                                             │     │
                     │  │  ┌────────────┐ ┌────────────┐ ┌──────────┐ │     │
                     │  │  │  Bedrock   │ │  AgentCore │ │CodeCommit│ │     │
                     │  │  │ Nova Lite  │ │   Memory   │◀│  (repo)  │ │     │
                     │  │  └────────────┘ └────────────┘ └──────────┘ │     │
                     │  │                       ▲            │        │     │
                     │  │                       └──(sync)────┘        │     │
                     │  └─────────────────────────────────────────────┘     │
                     │                                │                     │
                     │                           git clone                  │
                     │                                │                     │
                     └────────────────────────────────┼─────────────────────┘
                                                      │
                                                      ▼
                              ┌─────────────────────────────────────┐
                              │  Obsidian / Working Copy / CLI      │
                              │         (read-only sync)            │
                              └─────────────────────────────────────┘
```

### Processing Flow

1. **Ingress** - Slack webhook → API Gateway (mTLS) → Lambda (HMAC verify) → SQS
2. **Idempotency** - Worker acquires lock in DynamoDB, prevents duplicate processing
3. **Classification** - AgentCore Runtime (configurable model) determines intent and category
4. **Item Context** - AgentCore Memory (long-term cache) provides existing items for linking, with CodeCommit fallback
5. **Side Effects** - Execute in order with partial failure recovery:
   - Git commit to CodeCommit (ideas, decisions, projects, inbox)
   - Email via SES (tasks → task manager mail drop)
   - Reply via Slack API (confirmation)
6. **Learning** - AgentCore Memory stores user preferences from corrections

## Classification

| Type | Description | Example | Destination |
|------|-------------|---------|-------------|
| **inbox** | Quick notes, reminders | "Remember to call John" | `00-inbox/YYYY-MM-DD.md` |
| **idea** | Insights, concepts | "What if we cached API responses?" | `10-ideas/YYYY-MM-DD__<slug>__<sb-id>.md` |
| **decision** | Choices made | "Going with React for the frontend" | `20-decisions/YYYY-MM-DD__<slug>__<sb-id>.md` |
| **project** | Multi-step work | "Starting the Q2 marketing campaign" | `30-projects/YYYY-MM-DD__<slug>__<sb-id>.md` |
| **task** | Actionable items | "Need to review the PR today" | Task manager (via email) |

Ideas, decisions, and projects include:
- **SB_ID** - Unique identifier (`sb-a7f3c2d`) for linking between notes
- **Front Matter** - YAML metadata with id, type, title, created_at, tags
- **Auto-extracted Tags** - 2-4 tags derived from content

## Features

- **Smart Classification** - AI-powered categorization with confidence scoring
- **Memory-Based Item Lookup** - AgentCore Memory provides item context for intelligent linking
- **Memory-First Retrieval** - Items retrieved from Memory cache first, with CodeCommit fallback
- **Delta Sync** - Items sync to Memory automatically after each capture (non-blocking)
- **Timestamped Records** - Memory records include sync timestamps for historical tracking
- **Health Check** - Run `health` to verify Memory/CodeCommit consistency
- **Repair Command** - Run `repair` to sync only missing items without duplicates
- **Query Support** - Ask for reports, summaries, and project status overviews
- **Clarification Flow** - Asks when uncertain, remembers context
- **Fix Command** - Correct mistakes with `fix: change the title to...` or reclassify with `fix: this should be a task`
- **Git-Backed Storage** - Full history, diffable, portable Markdown
- **Obsidian/Git Sync** - Clone the repo locally for use with Obsidian or any Markdown editor
- **Task Manager Integration** - Tasks emailed to any mail drop (tested with OmniFocus; should work with Todoist, Things, etc.)
- **Task-Project Linking** - Automatically link tasks to projects via natural language
- **Multi-Item Messages** - Process multiple items in a single message
- **Project Status Management** - Update project status via Slack ("pause project X", "mark Y complete")
- **Idempotent Processing** - Safe retries, exactly-once semantics
- **Partial Failure Recovery** - Resumes from where it left off

## Quick Start

### Prerequisites

- Node.js 20+
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS CLI configured
- Slack workspace (admin access)
- (Optional) Task manager with Mail Drop (tested with OmniFocus; should work with Todoist, Things, etc.)

### Deploy

```bash
# Clone and install
git clone https://github.com/yourusername/second-brain-agent
cd second-brain-agent
npm install

# Configure secrets (choose your security mode)
./scripts/setup-ssm.sh --mode mtls-hmac    # Most secure (default)
./scripts/setup-ssm.sh --mode mtls-only    # mTLS only
./scripts/setup-ssm.sh --mode hmac-only    # Simplest setup

# Deploy
./scripts/deploy.sh --mode mtls-hmac --sender-email you@example.com
```

### Security Modes

| Mode | Description | Requirements |
|------|-------------|--------------|
| `mtls-hmac` | mTLS + HMAC signature verification | Custom domain + Route 53 hosted zone + ACM cert |
| `mtls-only` | mTLS certificate validation only | Custom domain + Route 53 hosted zone + ACM cert |
| `hmac-only` | HMAC signature verification only | No domain required (uses Lambda Function URL) |

**Note:** mTLS modes require a domain you control with DNS hosted in Route 53. If you don't have a custom domain, use `hmac-only` mode - it's still secure (HMAC signature verification) and simpler to set up.

### Configure Slack

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Add bot scopes: `chat:write`, `im:history`, `im:read`, `im:write`
3. Install to workspace, copy bot token
4. Enable Event Subscriptions with your Lambda URL
5. Subscribe to `message.im` events

See [Complete Setup Guide](./docs/SETUP.md) for detailed instructions.

## Usage

### Basic Messages

```
Remember to water the plants
```
→ Goes to inbox

```
I've decided to switch to TypeScript
```
→ Creates decision note

```
I need to call the dentist tomorrow
```
→ Emails to your task manager

### Fix Mistakes

```
fix: change the title to "TypeScript Migration Decision"
```

### Clarification

When the agent is unsure:
```
Bot: I'm not sure how to classify this. Is this an idea, decision, or task?
You: idea
Bot: ✓ Captured as idea...
```

### Sync with Obsidian

The knowledge repository is a standard Git repo. Clone it locally to browse and search with Obsidian or any Markdown tool:

```bash
# Clone the knowledge repo (requires git-remote-codecommit)
pip install git-remote-codecommit
git clone codecommit::<region>://second-brain-knowledge ~/SecondBrain

# Open in Obsidian as a vault
# Point Obsidian to ~/SecondBrain
```

Pull regularly to see new captures from Slack. Obsidian is read-only - all updates flow through Slack to avoid merge conflicts.

## Architecture

Second Brain is built on a fully serverless, event-driven architecture. Every component scales independently and you pay only for actual usage.

### Design Principles

- **Event-Driven** - SQS decouples ingress from processing, enabling retries and backpressure
- **Idempotent** - DynamoDB conditional writes ensure exactly-once processing
- **Recoverable** - Partial failures resume from last successful step
- **Observable** - CloudWatch metrics and structured logging throughout
- **Secure** - mTLS + HMAC verification, secrets in SSM Parameter Store

### Stacks

| Stack | Resources |
|-------|-----------|
| **IngressStack** | Lambda, SQS Queue, DLQ, (mTLS modes: API Gateway, Route 53, S3 truststore) |
| **CoreStack** | Worker Lambda, DynamoDB (2), CodeCommit, ECR, CodeBuild, AgentCore Runtime, SES |

### Extensibility

The modular design makes it easy to extend:

- **New Classifications** - Add categories by updating the system prompt
- **Other Task Managers** - Replace SES/OmniFocus with Todoist, Things, or webhooks
- **Additional Inputs** - Add email, SMS, or voice interfaces alongside Slack
- **Custom Models** - Use any Bedrock model or bring your own classifier

Note: The current implementation uses AWS CodeCommit for the knowledge repository. Swapping to GitHub or other Git providers would require code changes to the knowledge-store component.

### Security Modes

- **mtls-hmac** (default): API Gateway with mTLS + HMAC signature verification
- **mtls-only**: API Gateway with mTLS only (Slack client cert validation)
- **hmac-only**: Lambda Function URL with HMAC signature verification

### Key Design Decisions

- **Configurable Security** - Three modes: mTLS+HMAC (production), mTLS-only, HMAC-only (dev)
- **API Gateway with mTLS** (default) - Validates Slack client certificates for defense in depth
- **SQS** for async processing - Slack requires <3s response, processing takes longer
- **DynamoDB** for idempotency - conditional writes prevent duplicate processing
- **CodeCommit** over S3 - Git history, branch/merge capability, familiar tooling
- **AgentCore** over direct Bedrock - managed runtime, built-in observability

## Configuration

### SSM Parameters (Secrets)

| Parameter | Description | Required For |
|-----------|-------------|--------------|
| `/secondbrain/ingress/security_mode` | Security mode | All |
| `/second-brain/slack-signing-secret` | Webhook HMAC verification | mtls-hmac, hmac-only |
| `/second-brain/slack-bot-token` | API authentication | All |
| `/second-brain/omnifocus-maildrop-email` | Task manager mail drop | All |
| `/secondbrain/ingress/domain_name` | Custom domain | mtls-hmac, mtls-only |
| `/secondbrain/ingress/hosted_zone_id` | Route 53 zone | mtls-hmac, mtls-only |
| `/secondbrain/ingress/acm_cert_arn` | TLS certificate | mtls-hmac, mtls-only |

### CDK Context

| Key | Description | Default |
|-----|-------------|---------|
| `senderEmail` | SES sender address | `noreply@example.com` |
| `securityMode` | Ingress security mode | `mtls-hmac` |
| `classifierModel` | Bedrock model for classification | `global.amazon.nova-2-lite-v1:0` |
| `reasoningEffort` | Nova 2 extended thinking level | `disabled` |

### Model Selection

The classifier model can be configured at deploy time:

```bash
# Use default (Nova 2 Lite)
npx cdk deploy SecondBrainCoreStack

# Use Nova Micro
npx cdk deploy SecondBrainCoreStack -c classifierModel=amazon.nova-micro-v1:0

# Use Nova 2 Lite with reasoning enabled
npx cdk deploy SecondBrainCoreStack -c classifierModel=global.amazon.nova-2-lite-v1:0 -c reasoningEffort=low

# Use Claude Haiku
npx cdk deploy SecondBrainCoreStack -c classifierModel=anthropic.claude-3-5-haiku-20241022-v1:0
```

| Model | Model ID | Relative Cost | Description |
|-------|----------|---------------|-------------|
| Nova 2 Lite | `global.amazon.nova-2-lite-v1:0` | $ | Multimodal model processing text, image, and video inputs |
| Nova Micro | `amazon.nova-micro-v1:0` | $ | Text-only model delivering lowest latency responses |
| Nova Lite | `amazon.nova-lite-v1:0` | $ | Low-cost multimodal model for processing image, video, and text |
| Claude 3.5 Haiku | `anthropic.claude-3-5-haiku-20241022-v1:0` | $$$ | Anthropic text model with text input and output |

See [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) for current rates.

**Nova 2 Extended Thinking:** Enable step-by-step reasoning with `reasoningEffort`:
- `disabled` (default) - Standard responses
- `low` - Light reasoning
- `medium` - Balanced reasoning
- `high` - Deep analysis

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EMAIL_MODE` | `live` or `log` | `live` |

## Development

### Run Tests

```bash
npm test                          # All TypeScript tests (478)
npm test -- --run test/unit/      # Unit tests only
npm test -- --run test/property/  # Property tests only

# Python tests (48 property tests for item sync and memory retrieval)
cd agent && python -m pytest test_item_sync.py test_memory_first_retrieval.py -v
```

### Synthesize CDK

```bash
npx cdk synth
npx cdk diff
```

### Project Structure

```
.
├── agent/                  # Python classifier (AgentCore)
├── docs/                   # Documentation
├── lib/                    # CDK stacks
├── scripts/                # Deployment scripts
├── src/
│   ├── components/         # Business logic
│   ├── handlers/           # Lambda handlers
│   └── types/              # TypeScript types
├── system/                 # System prompt
└── test/
    ├── cdk/                # Infrastructure tests
    ├── integration/        # Flow tests
    ├── property/           # Property-based tests
    └── unit/               # Unit tests
```

## Documentation

- [Complete Setup Guide](./docs/SETUP.md) - Step-by-step installation
- [Usage Guide](./docs/USAGE.md) - How to use effectively
- [Troubleshooting](./docs/TROUBLESHOOTING.md) - Common issues

## Cost

Most AWS services used fall within free tier for personal use. Primary cost is Bedrock model invocations - configurable from budget models (Nova Micro ~$0.035/1M tokens) to premium models (Claude Haiku ~$0.80/1M tokens). See [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) for details.

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT - see [LICENSE](./LICENSE) for details.

---

Built with [AWS CDK](https://aws.amazon.com/cdk/), [Bedrock AgentCore](https://aws.amazon.com/bedrock/), and [Strands Agents](https://github.com/strands-agents/strands-agents).
