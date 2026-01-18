#!/bin/bash
# Second Brain Agent - Deployment Script
#
# Usage: ./scripts/deploy.sh [options]
#
# Options:
#   --profile <aws-profile>    AWS CLI profile to use
#   --sender-email <email>     SES verified sender email
#   --mode <security-mode>     Security mode (mtls-hmac, mtls-only, hmac-only)
#
# Security modes:
#   mtls-hmac  - API Gateway with mTLS + HMAC verification (default, most secure)
#   mtls-only  - API Gateway with mTLS only
#   hmac-only  - Lambda Function URL with HMAC only (simplest setup)
#
# Prerequisites:
# 1. AWS CLI configured with appropriate credentials
# 2. Node.js 20+ installed
# 3. SSM parameters created (run setup-ssm.sh first)
# 4. SES email identity verified

set -e

PROFILE_ARG=""
SENDER_EMAIL=""
SECURITY_MODE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)
      PROFILE_ARG="--profile $2"
      echo "Using AWS profile: $2"
      shift 2
      ;;
    --sender-email)
      SENDER_EMAIL="$2"
      shift 2
      ;;
    --mode)
      SECURITY_MODE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./scripts/deploy.sh [--profile <profile>] [--sender-email <email>] [--mode <mode>]"
      exit 1
      ;;
  esac
done

# Validate security mode if provided
if [ -n "$SECURITY_MODE" ]; then
  if [[ ! "$SECURITY_MODE" =~ ^(mtls-hmac|mtls-only|hmac-only)$ ]]; then
    echo "ERROR: Invalid security mode: $SECURITY_MODE"
    echo "Valid modes: mtls-hmac, mtls-only, hmac-only"
    exit 1
  fi
fi

# Build context arguments
CONTEXT_ARG=""
if [ -n "$SENDER_EMAIL" ]; then
  CONTEXT_ARG="$CONTEXT_ARG -c senderEmail=$SENDER_EMAIL"
  echo "Using sender email: $SENDER_EMAIL"
fi
if [ -n "$SECURITY_MODE" ]; then
  CONTEXT_ARG="$CONTEXT_ARG -c securityMode=$SECURITY_MODE"
  echo "Using security mode: $SECURITY_MODE"
else
  echo "Using default security mode: mtls-hmac"
fi

echo "=========================================="
echo "Second Brain Agent - Deployment"
echo "=========================================="

# Check prerequisites
echo ""
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found v$NODE_VERSION)"
  exit 1
fi

if ! command -v aws &> /dev/null; then
  echo "ERROR: AWS CLI is not installed"
  exit 1
fi

echo "✓ Prerequisites OK"

# Check for mTLS truststore if using mTLS mode
if [ -z "$SECURITY_MODE" ] || [ "$SECURITY_MODE" == "mtls-hmac" ] || [ "$SECURITY_MODE" == "mtls-only" ]; then
  if [ ! -f "certs/digicert-root-ca.pem" ]; then
    echo ""
    echo "mTLS truststore not found. Downloading DigiCert certificates..."
    ./scripts/setup-truststore.sh
  fi
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
npm ci

# Build TypeScript
echo ""
echo "Building TypeScript..."
npm run build

# Run tests
echo ""
echo "Running tests..."
npm test -- --run

# Bootstrap CDK (if needed)
echo ""
echo "Bootstrapping CDK..."
npx cdk bootstrap $PROFILE_ARG

# Deploy Ingress Stack first
echo ""
echo "Deploying Ingress Stack..."
npx cdk deploy SecondBrainIngressStack --require-approval never $PROFILE_ARG $CONTEXT_ARG

# Deploy Core Stack
echo ""
echo "Deploying Core Stack..."
npx cdk deploy SecondBrainCoreStack --require-approval never $PROFILE_ARG $CONTEXT_ARG

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Get the Webhook URL from the stack outputs"
echo "2. Configure your Slack app with the Webhook URL"
echo "3. Verify SES email identity if not done"
echo ""
echo "To get stack outputs:"
echo "  aws cloudformation describe-stacks --stack-name SecondBrainIngressStack --query 'Stacks[0].Outputs' $PROFILE_ARG"
echo ""
