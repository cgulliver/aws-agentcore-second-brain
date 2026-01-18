/**
 * Conversation Context Component
 * 
 * Manages conversation context in DynamoDB for multi-turn interactions.
 * Supports configurable TTL from SSM Parameter Store.
 * 
 * Validates: Requirements 9.1-9.7
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Conversation context structure
export interface ConversationContext {
  session_id: string;
  original_event_id: string;
  original_message: string;
  original_classification?: string;
  original_confidence?: number;
  clarification_asked: string;
  clarification_response?: string;
  created_at: string;
  expires_at: number;
}

// Conversation store configuration
export interface ConversationStoreConfig {
  tableName: string;
  ttlParam: string;
}

// Default TTL: 1 hour (3600 seconds)
const DEFAULT_TTL_SECONDS = 3600;

// AWS clients
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const ssmClient = new SSMClient({});

// Cached TTL value
let cachedTTL: number | null = null;

/**
 * Generate session ID from channel and user
 * Format: {channel_id}#{user_id}
 */
export function generateSessionId(channelId: string, userId: string): string {
  return `${channelId}#${userId}`;
}

/**
 * Parse session ID to extract channel and user
 */
export function parseSessionId(sessionId: string): { channelId: string; userId: string } {
  const [channelId, userId] = sessionId.split('#');
  return { channelId, userId };
}

/**
 * Load TTL from SSM Parameter Store
 * 
 * Validates: Requirements 9.5, 9.6, 9.7
 */
async function loadTTL(paramName: string): Promise<number> {
  if (cachedTTL !== null) {
    return cachedTTL;
  }

  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: paramName,
        WithDecryption: false,
      })
    );

    if (response.Parameter?.Value) {
      const ttl = parseInt(response.Parameter.Value, 10);
      if (!isNaN(ttl) && ttl > 0) {
        cachedTTL = ttl;
        return ttl;
      }
    }
  } catch (error) {
    console.warn('Failed to load TTL from SSM, using default', { error });
  }

  // Use default TTL
  cachedTTL = DEFAULT_TTL_SECONDS;
  return DEFAULT_TTL_SECONDS;
}

/**
 * Calculate expires_at timestamp
 */
function calculateExpiresAt(ttlSeconds: number): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds;
}

/**
 * Get conversation context by session ID
 * 
 * Validates: Requirements 9.1, 9.3
 */
export async function getContext(
  config: ConversationStoreConfig,
  channelId: string,
  userId: string
): Promise<ConversationContext | null> {
  const sessionId = generateSessionId(channelId, userId);

  const result = await docClient.send(
    new GetCommand({
      TableName: config.tableName,
      Key: { session_id: sessionId },
    })
  );

  if (!result.Item) {
    return null;
  }

  // Check if expired (DynamoDB TTL is eventually consistent)
  const context = result.Item as ConversationContext;
  const now = Math.floor(Date.now() / 1000);
  if (context.expires_at < now) {
    // Expired, delete and return null
    await deleteContext(config, channelId, userId);
    return null;
  }

  return context;
}

/**
 * Set conversation context
 * 
 * Validates: Requirements 9.1, 9.3, 9.4
 */
export async function setContext(
  config: ConversationStoreConfig,
  channelId: string,
  userId: string,
  context: Omit<ConversationContext, 'session_id' | 'created_at' | 'expires_at'>
): Promise<void> {
  const sessionId = generateSessionId(channelId, userId);
  const ttl = await loadTTL(config.ttlParam);
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: config.tableName,
      Item: {
        ...context,
        session_id: sessionId,
        created_at: now,
        expires_at: calculateExpiresAt(ttl),
      },
    })
  );
}

/**
 * Update conversation context with clarification response
 */
export async function updateContextWithResponse(
  config: ConversationStoreConfig,
  channelId: string,
  userId: string,
  clarificationResponse: string
): Promise<ConversationContext | null> {
  const existing = await getContext(config, channelId, userId);
  if (!existing) {
    return null;
  }

  const ttl = await loadTTL(config.ttlParam);

  const updated: ConversationContext = {
    ...existing,
    clarification_response: clarificationResponse,
    expires_at: calculateExpiresAt(ttl), // Extend TTL
  };

  await docClient.send(
    new PutCommand({
      TableName: config.tableName,
      Item: updated,
    })
  );

  return updated;
}

/**
 * Delete conversation context
 * 
 * Validates: Requirements 9.1
 */
export async function deleteContext(
  config: ConversationStoreConfig,
  channelId: string,
  userId: string
): Promise<void> {
  const sessionId = generateSessionId(channelId, userId);

  await docClient.send(
    new DeleteCommand({
      TableName: config.tableName,
      Key: { session_id: sessionId },
    })
  );
}

/**
 * Check if there's an active conversation context
 */
export async function hasActiveContext(
  config: ConversationStoreConfig,
  channelId: string,
  userId: string
): Promise<boolean> {
  const context = await getContext(config, channelId, userId);
  return context !== null;
}

/**
 * Clear cached TTL (for testing)
 */
export function clearTTLCache(): void {
  cachedTTL = null;
}

/**
 * Get current cached TTL (for testing)
 */
export function getCachedTTL(): number | null {
  return cachedTTL;
}
