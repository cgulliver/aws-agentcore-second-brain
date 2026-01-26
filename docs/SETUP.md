# Complete Setup Guide

This guide walks you through setting up the Second Brain Agent from scratch.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Security Modes](#security-modes)
3. [AWS Account Setup](#aws-account-setup)
4. [Slack App Configuration](#slack-app-configuration)
5. [OmniFocus Mail Drop Setup](#omnifocus-mail-drop-setup)
6. [SSM Parameters](#ssm-parameters)
7. [SES Email Configuration](#ses-email-configuration)
8. [Deployment](#deployment)
9. [Verification](#verification)

---

## Prerequisites

### Required Software

```bash
# Node.js 20+
node --version  # Should be v20.x or higher

# AWS CLI
aws --version

# AWS CDK CLI
npm install -g aws-cdk
cdk --version

# Container runtime (Docker or Finch)
docker --version  # or: finch --version
```

### AWS Account Requirements

- An AWS account with permissions to create:
  - Lambda functions
  - SQS queues
  - DynamoDB tables
  - CodeCommit repositories
  - ECR repositories
  - CodeBuild projects
  - SES email identities
  - SSM parameters
  - IAM roles and policies
  - Bedrock AgentCore Runtimes
  - (mTLS modes) API Gateway HTTP APIs
  - (mTLS modes) Route 53 records
  - (mTLS modes) S3 buckets

### Slack Workspace

- Admin access to a Slack workspace (or permission to create apps)

### OmniFocus (Optional)

- OmniFocus 3 or later with Mail Drop enabled
- Only required if you want task routing to OmniFocus

---

## Security Modes

The Second Brain Agent supports three security modes for the Slack webhook ingress:

| Mode | Description | Requirements | Use Case |
|------|-------------|--------------|----------|
| `mtls-hmac` | mTLS + HMAC signature verification | Custom domain, ACM cert, Route 53, Signing secret | Production (recommended) |
| `mtls-only` | mTLS certificate validation only | Custom domain, ACM cert, Route 53 | When HMAC overhead is undesirable |
| `hmac-only` | HMAC signature verification only | Signing secret only | Quick setup, development |

### mtls-hmac (Default, Recommended)

Defense in depth with two layers of authentication:
- **mTLS**: API Gateway validates Slack's client certificate (signed by DigiCert)
- **HMAC**: Lambda verifies request signature using Slack signing secret

Requires:
- Custom domain (e.g., `slack-api.yourdomain.com`)
- ACM certificate for the domain
- Route 53 hosted zone
- Slack signing secret

### mtls-only

Single layer authentication using mutual TLS:
- **mTLS**: API Gateway validates Slack's client certificate

Requires:
- Custom domain
- ACM certificate
- Route 53 hosted zone

### hmac-only

Single layer authentication using HMAC signatures:
- **HMAC**: Lambda verifies request signature using Slack signing secret
- Uses Lambda Function URL (no API Gateway or custom domain needed)

Requires:
- Slack signing secret only

### mTLS Truststore Setup

For mTLS modes, you need to download DigiCert CA certificates. Run:

```bash
./scripts/setup-truststore.sh
```

This downloads certificates directly from DigiCert to `certs/digicert-root-ca.pem`. The truststore includes root and intermediate CAs required to validate Slack's client certificate.

For more information on Slack's mTLS implementation:
https://api.slack.com/authentication/verifying-requests-from-slack#using-mutual-tls

---

## AWS Account Setup

### 1. Configure AWS CLI

```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter your default region (e.g., us-east-1)
# Enter output format (json)
```

### 2. Bootstrap CDK

```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

### 3. Enable Bedrock Model Access

1. Go to AWS Console → Amazon Bedrock
2. Navigate to Model access
3. Request access to your chosen models (Nova Micro is default, Claude Haiku optional)
4. Wait for approval (usually instant for Amazon models)

### 4. (mTLS modes) Domain Setup

If using `mtls-hmac` or `mtls-only`:

1. Have a domain in Route 53 (or create a hosted zone)
2. Request an ACM certificate:
   ```bash
   aws acm request-certificate \
     --domain-name "*.yourdomain.com" \
     --validation-method DNS \
     --region us-east-1
   ```
3. Validate via DNS (ACM provides CNAME records)

---

## Slack App Configuration

### 1. Create a New Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From manifest**
3. Paste the contents of `slack-app-manifest.yaml`
4. Update the `request_url` placeholder after deployment

Or create manually:
1. Click **Create New App** → **From scratch**
2. Name: `Second Brain`, select workspace

### 2. Configure Bot Token Scopes

In **OAuth & Permissions** → **Bot Token Scopes**, add:
- `chat:write`
- `im:history`
- `im:read`
- `im:write`

### 3. Install App to Workspace

1. Click **Install to Workspace**
2. Copy the **Bot User OAuth Token** (`xoxb-...`)

### 4. Get Signing Secret (mtls-hmac or hmac-only)

In **Basic Information** → **App Credentials**, copy the **Signing Secret**.

### 5. Enable Event Subscriptions (After Deployment)

1. In **Event Subscriptions**, toggle ON
2. Enter your webhook URL:
   - mTLS modes: `https://your-domain.com/slack/events`
   - hmac-only: Lambda Function URL from stack outputs
3. Subscribe to: `message.im`

### 6. Enable Direct Messages

In **App Home** → **Messages Tab**, enable messaging.

---

## OmniFocus Mail Drop Setup

### Find Your Mail Drop Address

**Mac**: OmniFocus → Preferences → Sync → Mail Drop

**iOS**: Settings → Mail Drop

### Test It

Email your Mail Drop address and verify the task appears.

---

## SSM Parameters

### Using the Setup Script (Recommended)

```bash
# For mtls-hmac (default)
./scripts/setup-ssm.sh --mode mtls-hmac

# For mtls-only
./scripts/setup-ssm.sh --mode mtls-only

# For hmac-only
./scripts/setup-ssm.sh --mode hmac-only
```

### Manual Setup

**Security Mode** (required):
```bash
aws ssm put-parameter \
  --name "/secondbrain/ingress/security_mode" \
  --type "String" \
  --value "mtls-hmac"
```

**Slack Signing Secret** (mtls-hmac, hmac-only):
```bash
aws ssm put-parameter \
  --name "/second-brain/slack-signing-secret" \
  --type "SecureString" \
  --value "YOUR_SIGNING_SECRET"
```

**Slack Bot Token** (all modes):
```bash
aws ssm put-parameter \
  --name "/second-brain/slack-bot-token" \
  --type "SecureString" \
  --value "xoxb-YOUR-TOKEN"
```

**OmniFocus Mail Drop** (all modes):
```bash
aws ssm put-parameter \
  --name "/second-brain/omnifocus-maildrop-email" \
  --type "SecureString" \
  --value "your-maildrop@sync.omnigroup.com"
```

**Custom Domain** (mtls-hmac, mtls-only):
```bash
aws ssm put-parameter \
  --name "/secondbrain/ingress/domain_name" \
  --type "String" \
  --value "slack-api.yourdomain.com"

aws ssm put-parameter \
  --name "/secondbrain/ingress/hosted_zone_id" \
  --type "String" \
  --value "Z1234567890ABC"

aws ssm put-parameter \
  --name "/secondbrain/ingress/acm_cert_arn" \
  --type "String" \
  --value "arn:aws:acm:us-east-1:123456789012:certificate/abc123"
```

---

## SES Email Configuration

### Verify Sender Email

```bash
aws ses verify-email-identity --email-address your-sender@example.com
```

Click the verification link in your email.

### SES Sandbox Mode

New AWS accounts are in SES sandbox mode, which requires verifying **both** sender AND recipient email addresses.

**For testing**, verify your OmniFocus Mail Drop address:
```bash
aws ses verify-email-identity --email-address your-maildrop@sync.omnigroup.com
```

The verification email will appear as a task in OmniFocus. Open the task notes and click the verification link.

**For production**, request to move out of sandbox:
```bash
aws sesv2 put-account-details \
  --mail-type TRANSACTIONAL \
  --website-url "https://your-site.com" \
  --use-case-description "Personal productivity app sending tasks to OmniFocus" \
  --contact-language EN
```

AWS typically approves within 24 hours. Once approved, you can send to any recipient without verification.

---

## Deployment

### 1. Install and Build

```bash
npm install
npm run build
npm test  # 416 TypeScript tests

# Optional: Run Python tests for item sync module
cd agent && python -m pytest test_item_sync.py -v  # 20 property tests
```

### 2. Setup Truststore (mTLS modes)

```bash
./scripts/setup-truststore.sh
```

### 3. Deploy

```bash
# Default (mtls-hmac)
./scripts/deploy.sh --sender-email you@example.com

# Specific mode
./scripts/deploy.sh --mode hmac-only --sender-email you@example.com
```

### 4. Get Webhook URL

```bash
aws cloudformation describe-stacks \
  --stack-name SecondBrainIngressStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WebhookUrl`].OutputValue' \
  --output text
```

### 5. Configure Slack

Update your Slack app's Event Subscriptions with the webhook URL.

---

## Verification

### Test the Bot

Send a DM:
```
Hello, this is a test
```

### Check Logs

```bash
aws logs tail /aws/lambda/second-brain-ingress --follow
aws logs tail /aws/lambda/second-brain-worker --follow
```

### Verify Security Mode

```bash
aws cloudformation describe-stacks \
  --stack-name SecondBrainIngressStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SecurityMode`].OutputValue' \
  --output text
```

---

## Changing Security Modes

1. Update SSM parameter
2. Add any new required parameters
3. Redeploy: `./scripts/deploy.sh --mode new-mode`

---

## Next Steps

- [Usage Guide](./USAGE.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

---

## Cloning the Knowledge Repository

After deployment, you can clone the CodeCommit knowledge repository to view your captured items locally with Obsidian or any Markdown editor.

### Install git-remote-codecommit

```bash
# Using pip
pip install git-remote-codecommit

# Or using a virtual environment
python -m venv ~/py
source ~/py/bin/activate
pip install git-remote-codecommit
```

### Clone the Repository

```bash
# Activate virtualenv if using one
source ~/py/bin/activate

# Clone (replace REGION with your AWS region, e.g., us-east-1)
git clone codecommit::REGION://second-brain-knowledge ~/SecondBrain
```

### Open in Obsidian

1. Open Obsidian
2. Click "Open folder as vault"
3. Select `~/SecondBrain`
4. Your captured ideas, decisions, and projects appear as linked notes

### Keeping in Sync

Pull regularly to see new captures:
```bash
cd ~/SecondBrain
git pull
```

**Note:** The knowledge repo is read-only from Obsidian's perspective. All updates flow through Slack to avoid merge conflicts. Use the `fix:` command in Slack to make corrections.

---

## Architecture Notes

### Bedrock AgentCore

The system uses Bedrock AgentCore for:
- **Runtime**: Hosts the classifier model (Nova 2 Lite by default)
- **Memory**: Stores item metadata for semantic retrieval and linking

Memory is automatically provisioned during deployment. Items are synced from CodeCommit to Memory on each request, enabling the classifier to find related projects/ideas without explicit tool calls.

### Model Selection

Configure the classifier model at deploy time:

```bash
# Nova 2 Lite (default)
./scripts/deploy.sh --sender-email you@example.com

# Nova Micro
./scripts/deploy.sh --sender-email you@example.com --model amazon.nova-micro-v1:0

# Claude Haiku
./scripts/deploy.sh --sender-email you@example.com --model anthropic.claude-3-5-haiku-20241022-v1:0
```

Or via CDK context:
```bash
npx cdk deploy --all -c classifierModel=global.amazon.nova-2-lite-v1:0
```
