#!/bin/bash
# Second Brain Agent - Update System Prompt
#
# Safely updates the system prompt in CodeCommit and bumps DEPLOY_VERSION
# to force Lambda to reload the prompt (5-minute cache).
#
# Usage: ./scripts/update-prompt.sh
#
# This script:
# 1. Pushes system/agent-system-prompt.md to the knowledge repo
# 2. Increments DEPLOY_VERSION in the Lambda environment
# 3. Preserves all other environment variables (unlike manual aws lambda update-function-configuration)

set -e

FUNCTION_NAME="second-brain-worker"
KNOWLEDGE_REPO="second-brain-knowledge"
PROMPT_FILE="system/agent-system-prompt.md"

echo "=========================================="
echo "Second Brain - Update System Prompt"
echo "=========================================="

# Check if prompt file exists
if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: $PROMPT_FILE not found"
  exit 1
fi

# Get current commit ID from knowledge repo
echo ""
echo "Getting current commit from $KNOWLEDGE_REPO..."
PARENT_COMMIT=$(aws codecommit get-branch \
  --repository-name "$KNOWLEDGE_REPO" \
  --branch-name main \
  --query 'branch.commitId' \
  --output text)

echo "Parent commit: $PARENT_COMMIT"

# Push prompt to knowledge repo
echo ""
echo "Pushing system prompt to CodeCommit..."
PUSH_RESULT=$(aws codecommit put-file \
  --repository-name "$KNOWLEDGE_REPO" \
  --branch-name main \
  --file-content "fileb://$PROMPT_FILE" \
  --file-path "$PROMPT_FILE" \
  --commit-message "Update system prompt" \
  --parent-commit-id "$PARENT_COMMIT" \
  --query 'commitId' \
  --output text 2>&1) || true

if echo "$PUSH_RESULT" | grep -q "SameFileContentException"; then
  echo "✓ System prompt unchanged (already up to date)"
else
  echo "✓ System prompt updated in CodeCommit"
fi

# Get current DEPLOY_VERSION
echo ""
echo "Getting current Lambda configuration..."
CURRENT_VERSION=$(aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --query 'Environment.Variables.DEPLOY_VERSION' \
  --output text)

# Handle case where DEPLOY_VERSION doesn't exist
if [ "$CURRENT_VERSION" == "None" ] || [ -z "$CURRENT_VERSION" ]; then
  CURRENT_VERSION="0"
fi

NEW_VERSION=$((CURRENT_VERSION + 1))
echo "Bumping DEPLOY_VERSION: $CURRENT_VERSION -> $NEW_VERSION"

# Get ALL current environment variables as JSON
CURRENT_ENV=$(aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --query 'Environment.Variables' \
  --output json)

# Update DEPLOY_VERSION in the JSON while preserving all other vars
# Using jq to safely modify the JSON
NEW_ENV=$(echo "$CURRENT_ENV" | jq --arg v "$NEW_VERSION" '.DEPLOY_VERSION = $v')

# Update Lambda with the modified environment (preserves all vars)
echo ""
echo "Updating Lambda environment..."
echo "{\"Variables\": $NEW_ENV}" > /tmp/lambda-env.json
aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --environment file:///tmp/lambda-env.json \
  --query 'Environment.Variables.DEPLOY_VERSION' \
  --output text > /dev/null
rm -f /tmp/lambda-env.json

echo "✓ DEPLOY_VERSION updated to $NEW_VERSION"

echo ""
echo "=========================================="
echo "System prompt update complete!"
echo "=========================================="
echo ""
echo "The Lambda will reload the prompt on next invocation."
echo "Note: There's a 5-minute cache, so changes may take up to 5 minutes to appear."
