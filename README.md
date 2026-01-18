# Second Brain Agent

> A personal knowledge capture system that turns Slack DMs into organized notes, decisions, and tasks.

[![Tests](https://img.shields.io/badge/tests-217%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)]()
[![AWS CDK](https://img.shields.io/badge/AWS%20CDK-2.x-orange)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

Send a message to your Slack bot, and it automatically:
- **Classifies** your thought (inbox, idea, decision, project, or task)
- **Stores** it in a Git repository as Markdown
- **Routes** tasks to OmniFocus via email
- **Confirms** what it did

No apps to open. No forms to fill. Just message your bot.

## Demo

```
You: I've decided to use PostgreSQL for the new project because of 
     better JSON support and our team's familiarity with it.

Bot: ✓ Captured as decision
     File: 20-decisions/2024-01-15-use-postgresql.md
     Commit: a1b2c3d
     
     Reply "fix: <instruction>" to make changes.
```

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Slack DM   │────▶│   Lambda    │────▶│  AgentCore  │
│             │     │  (Ingress)  │     │ (Classify)  │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
             ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
             │ CodeCommit  │           │     SES     │           │   Slack     │
             │ (Markdown)  │           │ (OmniFocus) │           │  (Reply)    │
             └─────────────┘           └─────────────┘           └─────────────┘
```

1. **Ingress Lambda** receives Slack webhooks, verifies signatures, queues messages
2. **Worker Lambda** orchestrates processing with idempotency guarantees
3. **AgentCore Runtime** (Claude) classifies messages and generates content
4. **Side effects** execute in order: Git commit → Email → Slack reply

## Classification

| Type | Description | Example | Destination |
|------|-------------|---------|-------------|
| **inbox** | Quick notes, reminders | "Remember to call John" | `00-inbox/YYYY-MM-DD.md` |
| **idea** | Insights, concepts | "What if we cached API responses?" | `10-ideas/<slug>.md` |
| **decision** | Choices made | "Going with React for the frontend" | `20-decisions/YYYY-MM-DD-<slug>.md` |
| **project** | Multi-step work | "Starting the Q2 marketing campaign" | `30-projects/<slug>.md` |
| **task** | Actionable items | "Need to review the PR today" | OmniFocus (via email) |

## Features

- **Smart Classification** - AI-powered categorization with confidence scoring
- **Clarification Flow** - Asks when uncertain, remembers context
- **Fix Command** - Correct mistakes with `fix: change the title to...`
- **Git-Backed Storage** - Full history, diffable, portable Markdown
- **OmniFocus Integration** - Tasks go straight to your task manager
- **Idempotent Processing** - Safe retries, exactly-once semantics
- **Partial Failure Recovery** - Resumes from where it left off

## Quick Start

### Prerequisites

- Node.js 20+
- AWS CLI configured
- Slack workspace (admin access)

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

| Mode | Security | Requirements |
|------|----------|--------------|
| `mtls-hmac` | Highest | Custom domain + ACM cert + Signing secret |
| `mtls-only` | High | Custom domain + ACM cert |
| `hmac-only` | Standard | Signing secret only (Lambda Function URL) |

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
→ Sends to OmniFocus

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

## Architecture

### Stacks

| Stack | Resources |
|-------|-----------|
| **IngressStack** | Lambda, SQS Queue, DLQ, (mTLS modes: API Gateway, Route 53, S3 truststore) |
| **CoreStack** | Worker Lambda, DynamoDB (2), CodeCommit, ECR, CodeBuild, AgentCore Runtime, SES |

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
| `/second-brain/omnifocus-maildrop-email` | Task routing | All |
| `/secondbrain/ingress/domain_name` | Custom domain | mtls-hmac, mtls-only |
| `/secondbrain/ingress/hosted_zone_id` | Route 53 zone | mtls-hmac, mtls-only |
| `/secondbrain/ingress/acm_cert_arn` | TLS certificate | mtls-hmac, mtls-only |

### CDK Context

| Key | Description | Default |
|-----|-------------|---------|
| `senderEmail` | SES sender address | `noreply@example.com` |
| `securityMode` | Ingress security mode | `mtls-hmac` |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EMAIL_MODE` | `live` or `log` | `live` |

## Development

### Run Tests

```bash
npm test                          # All tests
npm test -- --run test/unit/      # Unit tests only
npm test -- --run test/property/  # Property tests only
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

## Cost Estimate

For personal use (~100 messages/day):

| Service | Estimated Monthly Cost |
|---------|----------------------|
| Lambda | ~$0 (free tier) |
| DynamoDB | ~$0 (free tier) |
| SQS | ~$0 (free tier) |
| CodeCommit | ~$0 (free tier) |
| AgentCore/Bedrock | ~$5-10 |
| SES | ~$0.10 |
| **Total** | **~$5-10/month** |

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
