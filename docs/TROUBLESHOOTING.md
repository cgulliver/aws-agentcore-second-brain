# Troubleshooting Guide

Common issues and their solutions.

## Slack Issues

### mTLS URL Verification Fails (HTTP 403)

**Symptoms:** Slack shows "Your request URL responded with an HTTP error" when verifying the webhook URL in mTLS modes.

**Cause:** API Gateway is rejecting Slack's client certificate because the issuer CA is not in the truststore.

**Solutions:**

1. **Run the truststore setup script**
   ```bash
   ./scripts/setup-truststore.sh
   ./scripts/deploy.sh --mode mtls-hmac
   ```

2. **Verify truststore contains intermediate CAs**
   
   Slack's client certificate is signed by a DigiCert intermediate CA, not a root CA. The truststore must include both:
   ```bash
   # Check what's in the truststore
   aws s3 cp s3://second-brain-mtls-truststore-YOUR_ACCOUNT_ID/truststore/digicert-root-ca.pem - | \
     openssl storeutl -noout -text -certs /dev/stdin 2>/dev/null | grep "Subject:"
   ```

3. **Manually add a missing intermediate CA**
   ```bash
   # Download from DigiCert directly
   curl -s https://cacerts.digicert.com/DigiCertTLSRSASHA2562020CA1.crt.pem >> certs/digicert-root-ca.pem
   
   # Redeploy
   ./scripts/deploy.sh --mode mtls-hmac
   ```

3. **Force truststore refresh**
   ```bash
   # Get current version
   aws s3api head-object \
     --bucket second-brain-mtls-truststore-YOUR_ACCOUNT_ID \
     --key truststore/digicert-root-ca.pem \
     --query 'VersionId'
   
   # Update API Gateway domain to use new version
   aws apigatewayv2 update-domain-name \
     --domain-name your-domain.com \
     --mutual-tls-authentication TruststoreUri=s3://...,TruststoreVersion=NEW_VERSION
   ```

4. **Check API Gateway logs for certificate details**
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/apigateway/second-brain-ingress \
     --start-time $(date -v-10M +%s000) \
     --query 'events[*].message'
   ```

### Bot doesn't respond to messages

**Symptoms:** Messages sent to the bot receive no response.

**Possible causes and solutions:**

1. **Event Subscriptions not configured**
   - Go to Slack App → Event Subscriptions
   - Verify Events are enabled
   - Check Request URL shows ✓ verified
   - Ensure `message.im` is subscribed

2. **Wrong Function URL**
   ```bash
   # Get the correct URL
   aws cloudformation describe-stacks \
     --stack-name SecondBrainIngressStack \
     --query 'Stacks[0].Outputs[?OutputKey==`FunctionUrl`].OutputValue' \
     --output text
   ```

3. **Signature verification failing**
   - Check CloudWatch logs for "Invalid signature"
   - Verify signing secret in SSM matches Slack app
   ```bash
   aws ssm get-parameter \
     --name "/second-brain/slack-signing-secret" \
     --with-decryption \
     --query 'Parameter.Value' \
     --output text
   ```

4. **Bot token invalid**
   - Reinstall the Slack app to get a new token
   - Update SSM parameter with new token

### Bot responds with errors

**Check CloudWatch Logs:**
```bash
# Ingress Lambda
aws logs tail /aws/lambda/second-brain-ingress --follow

# Worker Lambda  
aws logs tail /aws/lambda/second-brain-worker --follow
```

### "URL verification failed" in Slack

The Lambda must respond to Slack's challenge within 3 seconds.

1. Check Lambda timeout is at least 10 seconds
2. Check for cold start issues
3. Verify the handler returns the challenge correctly

## AWS Issues

### DynamoDB errors

**"ResourceNotFoundException"**
```bash
# Verify tables exist
aws dynamodb list-tables --query 'TableNames[?contains(@, `second-brain`)]'
```

**"ConditionalCheckFailedException"**
- This is expected for duplicate events (idempotency working correctly)
- Check if the same event is being processed multiple times

### CodeCommit errors

**"RepositoryDoesNotExistException"**
```bash
# Verify repository exists
aws codecommit get-repository --repository-name second-brain-knowledge
```

**"ParentCommitIdOutdatedException"**
- Concurrent writes detected
- The system retries automatically (up to 3 times)
- If persistent, check for rapid message bursts

### SES errors

**"MessageRejected: Email address is not verified"**
- You're in SES sandbox mode
- Either verify the recipient email or request production access

**"Throttling"**
- You've hit SES sending limits
- Request a sending limit increase in AWS Console

### AgentCore errors

**"Runtime not found"**
```bash
# Check runtime status
aws cloudformation describe-stack-resource \
  --stack-name SecondBrainCoreStack \
  --logical-resource-id ClassifierRuntime
```

**"Container image not found"**
- CodeBuild may have failed
- Check CodeBuild logs:
```bash
aws codebuild list-builds-for-project \
  --project-name second-brain-classifier-build \
  --max-items 1
```

## Message Processing Issues

### Messages stuck in queue

```bash
# Check queue depth
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name second-brain-ingress --query 'QueueUrl' --output text) \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

**If messages are accumulating:**
1. Check Worker Lambda for errors
2. Verify Lambda has SQS trigger configured
3. Check DLQ for failed messages

### Messages going to DLQ

```bash
# Check DLQ
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name second-brain-ingress-dlq --query 'QueueUrl' --output text) \
  --attribute-names ApproximateNumberOfMessages
```

**To inspect DLQ messages:**
```bash
aws sqs receive-message \
  --queue-url $(aws sqs get-queue-url --queue-name second-brain-ingress-dlq --query 'QueueUrl' --output text) \
  --max-number-of-messages 1
```

### Wrong classification

1. Check the system prompt in CodeCommit:
   ```bash
   aws codecommit get-file \
     --repository-name second-brain-knowledge \
     --file-path system/agent-system-prompt.md \
     --query 'fileContent' \
     --output text | base64 -d
   ```

2. Review classification rules in the prompt
3. Use the fix command to correct individual entries
4. Consider adjusting confidence thresholds

### Fix command not working

**"No recent entry found to fix"**
- The fix command only works on your most recent entry
- Tasks cannot be fixed (already sent to OmniFocus)
- Clarification requests cannot be fixed

**"Cannot fix a task"**
- Tasks are sent to OmniFocus immediately
- Delete the task in OmniFocus and resend the message

## OmniFocus Issues

### Tasks not appearing in OmniFocus

1. **Verify Mail Drop email**
   ```bash
   aws ssm get-parameter \
     --name "/second-brain/omnifocus-maildrop-email" \
     --with-decryption \
     --query 'Parameter.Value' \
     --output text
   ```

2. **Check SES sending**
   - Verify sender email is verified
   - Check SES sending statistics in AWS Console

3. **Check EMAIL_MODE**
   - If set to `log`, emails are not actually sent
   - Check Worker Lambda environment variables

4. **OmniFocus sync**
   - Ensure OmniFocus is syncing
   - Check OmniFocus → Preferences → Sync

### Task format issues

The task email format is:
- **Subject:** Task title (imperative voice)
- **Body:** Context and source reference

If tasks appear incorrectly formatted, check the `formatTaskEmail()` function in `src/components/task-router.ts`.

## Performance Issues

### Slow responses

**Cold starts:**
- First message after idle period may be slow
- Consider provisioned concurrency for production

**AgentCore latency:**
- LLM inference takes 2-5 seconds typically
- Check AgentCore logs for slow responses

### Rate limiting

**Slack 429 errors:**
- The system automatically retries with backoff
- If persistent, you're sending too many messages

**SES throttling:**
- Request a sending limit increase
- Implement message batching for high volume

## Debugging Tips

### Enable verbose logging

Set log level in Lambda environment:
```
LOG_LEVEL=debug
```

### Test individual components

```bash
# Test signature verification
npm test -- --run test/unit/ingress.test.ts

# Test classification
npm test -- --run test/property/classification-path.property.test.ts
```

### Inspect receipts

```bash
# Get recent receipts
aws codecommit get-file \
  --repository-name second-brain-knowledge \
  --file-path 90-receipts/receipts.jsonl \
  --query 'fileContent' \
  --output text | base64 -d | tail -5
```

### Check idempotency records

```bash
aws dynamodb scan \
  --table-name second-brain-idempotency \
  --limit 5 \
  --query 'Items[*].{event_id:event_id.S,status:status.S}'
```

## Getting Help

1. Check CloudWatch Logs for detailed error messages
2. Review the receipts for processing history
3. Run the test suite to verify component functionality
4. Check AWS service health dashboard for outages
