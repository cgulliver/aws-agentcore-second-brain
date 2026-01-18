#!/bin/bash
# Second Brain Agent - SSM Parameter Setup
#
# Usage: ./scripts/setup-ssm.sh [--profile <aws-profile>] [--mode <security-mode>]
#
# Security modes:
#   mtls-hmac  - API Gateway with mTLS + HMAC (most secure, default)
#   mtls-only  - API Gateway with mTLS only
#   hmac-only  - Lambda Function URL with HMAC only
#
# This script creates the required SSM parameters based on the selected mode.

set -e

PROFILE_ARG=""
SECURITY_MODE="mtls-hmac"

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)
      PROFILE_ARG="--profile $2"
      echo "Using AWS profile: $2"
      shift 2
      ;;
    --mode)
      SECURITY_MODE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./scripts/setup-ssm.sh [--profile <aws-profile>] [--mode <security-mode>]"
      exit 1
      ;;
  esac
done

# Validate security mode
if [[ ! "$SECURITY_MODE" =~ ^(mtls-hmac|mtls-only|hmac-only)$ ]]; then
  echo "ERROR: Invalid security mode: $SECURITY_MODE"
  echo "Valid modes: mtls-hmac, mtls-only, hmac-only"
  exit 1
fi

echo "=========================================="
echo "Second Brain Agent - SSM Parameter Setup"
echo "=========================================="
echo ""
echo "Security Mode: $SECURITY_MODE"
echo ""

# Function to create SecureString parameter
create_secure_param() {
  local name=$1
  local description=$2
  
  echo "----------------------------------------"
  echo "Parameter: $name"
  echo "Description: $description"
  echo ""
  read -sp "Enter value (hidden): " value
  echo ""
  
  if [ -z "$value" ]; then
    echo "Skipping (no value provided)"
    return
  fi
  
  aws ssm put-parameter \
    --name "$name" \
    --type "SecureString" \
    --value "$value" \
    --description "$description" \
    --overwrite \
    $PROFILE_ARG
  
  echo "✓ Created $name"
}

# Function to create String parameter
create_string_param() {
  local name=$1
  local description=$2
  
  echo "----------------------------------------"
  echo "Parameter: $name"
  echo "Description: $description"
  echo ""
  read -p "Enter value: " value
  echo ""
  
  if [ -z "$value" ]; then
    echo "Skipping (no value provided)"
    return
  fi
  
  aws ssm put-parameter \
    --name "$name" \
    --type "String" \
    --value "$value" \
    --description "$description" \
    --overwrite \
    $PROFILE_ARG
  
  echo "✓ Created $name"
}

# Store security mode
echo ""
echo "=== Security Mode Configuration ==="
echo ""
aws ssm put-parameter \
  --name "/secondbrain/ingress/security_mode" \
  --type "String" \
  --value "$SECURITY_MODE" \
  --description "Ingress security mode: mtls-hmac, mtls-only, or hmac-only" \
  --overwrite \
  $PROFILE_ARG
echo "✓ Created /secondbrain/ingress/security_mode = $SECURITY_MODE"

# Slack Signing Secret (required for mtls-hmac and hmac-only)
if [[ "$SECURITY_MODE" == "mtls-hmac" || "$SECURITY_MODE" == "hmac-only" ]]; then
  echo ""
  echo "=== Slack Configuration (HMAC) ==="
  echo ""
  echo "Get the Signing Secret from your Slack App settings:"
  echo "  https://api.slack.com/apps -> Your App -> Basic Information"
  echo ""
  
  create_secure_param \
    "/second-brain/slack-signing-secret" \
    "Slack app signing secret for HMAC webhook verification"
fi

# Domain configuration (required for mtls-hmac and mtls-only)
if [[ "$SECURITY_MODE" == "mtls-hmac" || "$SECURITY_MODE" == "mtls-only" ]]; then
  echo ""
  echo "=== API Gateway Custom Domain (mTLS) ==="
  echo ""
  echo "You need:"
  echo "  - A custom domain (e.g., slack-api.yourdomain.com)"
  echo "  - A Route 53 hosted zone for your domain"
  echo "  - An ACM certificate (wildcard or specific)"
  echo ""
  
  create_string_param \
    "/secondbrain/ingress/domain_name" \
    "Custom domain for Slack webhook (e.g., slack-api.yourdomain.com)"
  
  create_string_param \
    "/secondbrain/ingress/hosted_zone_id" \
    "Route 53 Hosted Zone ID for the domain"
  
  create_string_param \
    "/secondbrain/ingress/acm_cert_arn" \
    "ACM Certificate ARN for the custom domain"
fi

# Slack Bot Token (always required)
echo ""
echo "=== Slack Bot Configuration ==="
echo ""
echo "Get the Bot Token from your Slack App settings:"
echo "  https://api.slack.com/apps -> Your App -> OAuth & Permissions"
echo ""

create_secure_param \
  "/second-brain/slack-bot-token" \
  "Slack bot OAuth token (xoxb-...)"

# OmniFocus Mail Drop
echo ""
echo "=== OmniFocus Configuration ==="
echo ""
echo "Get your Mail Drop address from OmniFocus:"
echo "  OmniFocus -> Settings -> Mail Drop"
echo ""

create_secure_param \
  "/second-brain/omnifocus-maildrop-email" \
  "OmniFocus Mail Drop email address"

echo ""
echo "=========================================="
echo "SSM Parameter Setup Complete!"
echo "=========================================="
echo ""
echo "Security Mode: $SECURITY_MODE"
echo ""
echo "Parameters created based on mode:"
echo "  - /secondbrain/ingress/security_mode"
if [[ "$SECURITY_MODE" == "mtls-hmac" || "$SECURITY_MODE" == "hmac-only" ]]; then
  echo "  - /second-brain/slack-signing-secret"
fi
if [[ "$SECURITY_MODE" == "mtls-hmac" || "$SECURITY_MODE" == "mtls-only" ]]; then
  echo "  - /secondbrain/ingress/domain_name"
  echo "  - /secondbrain/ingress/hosted_zone_id"
  echo "  - /secondbrain/ingress/acm_cert_arn"
fi
echo "  - /second-brain/slack-bot-token"
echo "  - /second-brain/omnifocus-maildrop-email"
echo ""
echo "Next: Run ./scripts/deploy.sh --mode $SECURITY_MODE"
echo ""
