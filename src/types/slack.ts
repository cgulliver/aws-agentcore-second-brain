/**
 * Slack Event Types and Interfaces
 * 
 * Validates: Requirements 1-5 (Slack Request Handling)
 */

/**
 * Slack URL verification request
 * Sent when configuring the webhook endpoint
 */
export interface SlackUrlVerificationRequest {
  type: 'url_verification';
  token: string;
  challenge: string;
}

/**
 * Slack event callback request
 * Contains the actual message event
 */
export interface SlackEventCallbackRequest {
  type: 'event_callback';
  token: string;
  team_id: string;
  api_app_id: string;
  event: SlackMessageEvent;
  event_id: string;
  event_time: number;
  authorizations: SlackAuthorization[];
}

/**
 * Slack message event (inner event object)
 * DM events have channel_type: "im"
 */
export interface SlackMessageEvent {
  type: string;
  channel: string;
  channel_type?: string; // "im" for direct messages
  user?: string;
  text?: string;
  ts: string;
  event_ts: string;
  bot_id?: string; // Present if message is from a bot
  subtype?: string; // Present for edits, deletes, etc.
  thread_ts?: string; // Present if message is in a thread
}

/**
 * Slack authorization info
 */
export interface SlackAuthorization {
  enterprise_id: string | null;
  team_id: string;
  user_id: string;
  is_bot: boolean;
}

/**
 * Union type for all Slack request types
 */
export type SlackRequest = SlackUrlVerificationRequest | SlackEventCallbackRequest;

/**
 * Type guard for URL verification requests
 */
export function isUrlVerification(request: SlackRequest): request is SlackUrlVerificationRequest {
  return request.type === 'url_verification';
}

/**
 * Type guard for event callback requests
 */
export function isEventCallback(request: SlackRequest): request is SlackEventCallbackRequest {
  return request.type === 'event_callback';
}

/**
 * Slack context extracted from an event
 * Used for receipts and replies
 */
export interface SlackContext {
  event_id: string;
  user_id: string;
  channel_id: string;
  message_ts: string;
  thread_ts?: string;
}

/**
 * SQS message format for enqueued Slack events
 */
export interface SQSEventMessage {
  event_id: string;
  event_time: number;
  channel_id: string;
  user_id: string;
  message_ts: string;
  message_text: string;
  thread_ts?: string;
  received_at: string; // ISO timestamp
}

/**
 * Slack Web API response for chat.postMessage
 */
export interface SlackPostMessageResponse {
  ok: boolean;
  channel?: string;
  ts?: string;
  message?: {
    text: string;
    ts: string;
  };
  error?: string;
}
