/**
 * Ingress Handler Unit Tests
 * 
 * Validates: Requirements 1-5, 26 (Slack Request Handling)
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  verifySlackSignature,
  isValidTimestamp,
  shouldProcessEvent,
} from '../../src/handlers/ingress';
import type { SlackEventCallbackRequest } from '../../src/types';

describe('Slack Signature Verification', () => {
  const signingSecret = 'test-signing-secret';

  it('should accept valid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = '{"type":"event_callback"}';
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac('sha256', signingSecret);
    hmac.update(baseString);
    const signature = `v0=${hmac.digest('hex')}`;

    expect(verifySlackSignature(signingSecret, timestamp, body, signature)).toBe(true);
  });

  it('should reject invalid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = '{"type":"event_callback"}';
    const invalidSignature = 'v0=invalid';

    expect(verifySlackSignature(signingSecret, timestamp, body, invalidSignature)).toBe(false);
  });

  it('should reject signature with wrong secret', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = '{"type":"event_callback"}';
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac('sha256', 'wrong-secret');
    hmac.update(baseString);
    const signature = `v0=${hmac.digest('hex')}`;

    expect(verifySlackSignature(signingSecret, timestamp, body, signature)).toBe(false);
  });

  it('should reject signature with tampered body', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const originalBody = '{"type":"event_callback"}';
    const tamperedBody = '{"type":"event_callback","extra":"data"}';
    const baseString = `v0:${timestamp}:${originalBody}`;
    const hmac = createHmac('sha256', signingSecret);
    hmac.update(baseString);
    const signature = `v0=${hmac.digest('hex')}`;

    expect(verifySlackSignature(signingSecret, timestamp, tamperedBody, signature)).toBe(false);
  });
});

describe('Timestamp Validation', () => {
  it('should accept timestamp within 5 minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isValidTimestamp(now)).toBe(true);
    expect(isValidTimestamp(now - 60)).toBe(true); // 1 minute ago
    expect(isValidTimestamp(now - 299)).toBe(true); // Just under 5 minutes
  });

  it('should reject timestamp older than 5 minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isValidTimestamp(now - 301)).toBe(false); // Just over 5 minutes
    expect(isValidTimestamp(now - 600)).toBe(false); // 10 minutes ago
  });

  it('should reject timestamp too far in the future', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isValidTimestamp(now + 120)).toBe(false); // 2 minutes in future
  });

  it('should accept timestamp with reasonable clock skew', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isValidTimestamp(now + 30)).toBe(true); // 30 seconds in future (within tolerance)
  });

  it('should use custom tolerance', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isValidTimestamp(now - 120, 60)).toBe(false); // 2 min ago with 1 min tolerance
    expect(isValidTimestamp(now - 30, 60)).toBe(true); // 30 sec ago with 1 min tolerance
  });
});

describe('Event Filtering', () => {
  const createEvent = (overrides: Partial<SlackEventCallbackRequest['event']> = {}): SlackEventCallbackRequest => ({
    type: 'event_callback',
    token: 'test-token',
    team_id: 'T123',
    api_app_id: 'A123',
    event: {
      type: 'message',
      channel: 'D123',
      channel_type: 'im',
      user: 'U123',
      text: 'Hello world',
      ts: '1234567890.123456',
      event_ts: '1234567890.123456',
      ...overrides,
    },
    event_id: 'Ev123',
    event_time: 1234567890,
    authorizations: [],
  });

  it('should accept valid DM event', () => {
    const event = createEvent();
    expect(shouldProcessEvent(event)).toBe(true);
  });

  it('should reject non-DM events', () => {
    const channelEvent = createEvent({ channel_type: 'channel' });
    expect(shouldProcessEvent(channelEvent)).toBe(false);

    const groupEvent = createEvent({ channel_type: 'group' });
    expect(shouldProcessEvent(groupEvent)).toBe(false);

    const noChannelType = createEvent({ channel_type: undefined });
    expect(shouldProcessEvent(noChannelType)).toBe(false);
  });

  it('should reject bot messages', () => {
    const botEvent = createEvent({ bot_id: 'B123' });
    expect(shouldProcessEvent(botEvent)).toBe(false);
  });

  it('should reject message edits', () => {
    const editEvent = createEvent({ subtype: 'message_changed' });
    expect(shouldProcessEvent(editEvent)).toBe(false);
  });

  it('should reject message deletes', () => {
    const deleteEvent = createEvent({ subtype: 'message_deleted' });
    expect(shouldProcessEvent(deleteEvent)).toBe(false);
  });

  it('should reject messages without text', () => {
    const noTextEvent = createEvent({ text: undefined });
    expect(shouldProcessEvent(noTextEvent)).toBe(false);

    const emptyTextEvent = createEvent({ text: '' });
    expect(shouldProcessEvent(emptyTextEvent)).toBe(false);
  });

  it('should accept threaded replies in DMs', () => {
    const threadedEvent = createEvent({ thread_ts: '1234567890.000000' });
    expect(shouldProcessEvent(threadedEvent)).toBe(true);
  });
});
