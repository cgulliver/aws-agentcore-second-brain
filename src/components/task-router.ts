/**
 * Task Router Component
 * 
 * Formats and sends task emails to OmniFocus via Mail Drop.
 * 
 * Validates: Requirements 17, 18, 39
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Task email structure
export interface TaskEmail {
  subject: string;
  body: string;
}

// Task router configuration
export interface TaskRouterConfig {
  sesRegion: string;
  fromEmail: string;
  mailDropParam: string;
}

// Send result
export interface TaskSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Slack source reference
export interface SlackSource {
  userId: string;
  channelId: string;
  messageTs: string;
}

// AWS clients
const sesClient = new SESClient({});
const ssmClient = new SSMClient({});

// Cached Mail Drop email
let cachedMailDrop: string | null = null;

/**
 * Get OmniFocus Mail Drop email from SSM
 */
async function getMailDropEmail(paramName: string): Promise<string> {
  if (cachedMailDrop) {
    return cachedMailDrop;
  }

  const response = await ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    })
  );

  if (!response.Parameter?.Value) {
    throw new Error('Mail Drop email not found in SSM');
  }

  cachedMailDrop = response.Parameter.Value;
  return cachedMailDrop;
}

/**
 * Format task email for OmniFocus Mail Drop
 * 
 * Validates: Requirements 18, 39
 * 
 * OmniFocus Mail Drop format:
 * - Subject becomes task title
 * - Body becomes task note
 * - Can include :: for project assignment
 * - Can include # for tags
 * - Can include // for due date
 */
export function formatTaskEmail(
  taskTitle: string,
  context: string,
  slackSource: SlackSource
): TaskEmail {
  // Ensure title is in imperative voice (basic check)
  let title = taskTitle.trim();
  
  // Remove leading "I need to" or similar phrases
  const prefixesToRemove = [
    /^i need to\s+/i,
    /^i should\s+/i,
    /^i have to\s+/i,
    /^i must\s+/i,
    /^need to\s+/i,
    /^should\s+/i,
    /^have to\s+/i,
    /^must\s+/i,
  ];

  for (const prefix of prefixesToRemove) {
    title = title.replace(prefix, '');
  }

  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Build body with context and source reference
  const bodyLines: string[] = [];

  if (context) {
    bodyLines.push(context);
    bodyLines.push('');
  }

  bodyLines.push('---');
  bodyLines.push(`Source: Slack DM`);
  bodyLines.push(`User: ${slackSource.userId}`);
  bodyLines.push(`Timestamp: ${slackSource.messageTs}`);

  return {
    subject: title,
    body: bodyLines.join('\n'),
  };
}

/**
 * Send task email via SES
 * 
 * Validates: Requirements 17.1, 17.2
 */
export async function sendTaskEmail(
  config: TaskRouterConfig,
  email: TaskEmail
): Promise<TaskSendResult> {
  try {
    const mailDropEmail = await getMailDropEmail(config.mailDropParam);

    const response = await sesClient.send(
      new SendEmailCommand({
        Source: config.fromEmail,
        Destination: {
          ToAddresses: [mailDropEmail],
        },
        Message: {
          Subject: {
            Data: email.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: email.body,
              Charset: 'UTF-8',
            },
          },
        },
      })
    );

    return {
      success: true,
      messageId: response.MessageId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Clear cached Mail Drop email (for testing)
 */
export function clearMailDropCache(): void {
  cachedMailDrop = null;
}
