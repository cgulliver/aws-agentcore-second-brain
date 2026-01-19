/**
 * Unit Tests for Components
 * 
 * Tests for idempotency guard, knowledge store, receipt logger,
 * system prompt loader, action plan, and action executor.
 */

import { describe, it, expect } from 'vitest';
import {
  generateFilePath,
  generateSlug,
} from '../../src/components/knowledge-store';
import {
  createReceipt,
  serializeReceipt,
  parseReceipt,
} from '../../src/components/receipt-logger';
import {
  computePromptHash,
  validatePromptStructure,
} from '../../src/components/system-prompt-loader';
import {
  validateActionPlan,
  parseActionPlanFromLLM,
  createDefaultActionPlan,
  requiresClarification,
  hasHighConfidence,
} from '../../src/components/action-plan';

// ============================================================================
// Knowledge Store Tests
// ============================================================================

describe('Knowledge Store', () => {
  describe('generateFilePath', () => {
    it('generates inbox path with date', () => {
      const date = new Date('2026-01-17');
      const path = generateFilePath('inbox', undefined, date);
      expect(path).toBe('00-inbox/2026-01-17.md');
    });

    it('generates idea path with slug', () => {
      const path = generateFilePath('idea', 'my-great-idea');
      expect(path).toMatch(/^10-ideas\/my-great-idea\.md$/);
    });

    it('generates decision path with date and slug', () => {
      const date = new Date('2026-01-17');
      const path = generateFilePath('decision', 'important-choice', date);
      expect(path).toBe('20-decisions/2026-01-17-important-choice.md');
    });

    it('generates project path with slug', () => {
      const path = generateFilePath('project', 'my-project');
      expect(path).toBe('30-projects/my-project.md');
    });

    it('throws for idea without slug', () => {
      expect(() => generateFilePath('idea')).toThrow('Slug required');
    });

    it('throws for decision without slug', () => {
      expect(() => generateFilePath('decision')).toThrow('Slug required');
    });

    it('throws for project without slug', () => {
      expect(() => generateFilePath('project')).toThrow('Slug required');
    });
  });

  describe('generateSlug', () => {
    it('converts to lowercase', () => {
      const slug = generateSlug('Hello World Test');
      expect(slug).toBe('hello-world-test');
    });

    it('removes non-ASCII characters', () => {
      const slug = generateSlug('Café résumé naïve');
      expect(slug).toBe('caf-rsum-nave');
    });

    it('removes special characters', () => {
      const slug = generateSlug('Hello! World? Test.');
      expect(slug).toBe('hello-world-test');
    });

    it('limits to 8 words', () => {
      const slug = generateSlug('one two three four five six seven eight nine ten');
      const words = slug.split('-');
      expect(words.length).toBeLessThanOrEqual(8);
    });

    it('pads to at least 3 words', () => {
      const slug = generateSlug('hi');
      const words = slug.split('-');
      expect(words.length).toBeGreaterThanOrEqual(3);
    });

    it('returns fallback for empty input', () => {
      const slug = generateSlug('');
      expect(slug).toBe('untitled-note');
    });

    it('removes date-like patterns', () => {
      const slug = generateSlug('Meeting notes 2026 01 17');
      expect(slug).not.toContain('2026');
    });
  });
});

// ============================================================================
// Receipt Logger Tests
// ============================================================================

describe('Receipt Logger', () => {
  describe('createReceipt', () => {
    it('creates receipt with all required fields', () => {
      const receipt = createReceipt(
        'event-123',
        { user_id: 'U123', channel_id: 'C456', message_ts: '1234567890.123456' },
        'inbox',
        0.9,
        [{ type: 'commit', status: 'success', details: { commitId: 'abc123' } }],
        ['00-inbox/2026-01-17.md'],
        'abc123',
        'Test message'
      );

      expect(receipt.event_id).toBe('event-123');
      expect(receipt.classification).toBe('inbox');
      expect(receipt.confidence).toBe(0.9);
      expect(receipt.slack.user_id).toBe('U123');
      expect(receipt.commit_id).toBe('abc123');
      expect(receipt.timestamp_iso).toBeDefined();
    });

    it('includes optional fields when provided', () => {
      const receipt = createReceipt(
        'event-123',
        { user_id: 'U123', channel_id: 'C456', message_ts: '1234567890.123456' },
        'inbox',
        0.9,
        [],
        [],
        null,
        'Test',
        {
          priorCommitId: 'prior-abc',
          promptCommitId: 'prompt-123',
          promptSha256: 'sha256-hash',
          validationErrors: ['error1'],
        }
      );

      expect(receipt.prior_commit_id).toBe('prior-abc');
      expect(receipt.prompt_commit_id).toBe('prompt-123');
      expect(receipt.prompt_sha256).toBe('sha256-hash');
      expect(receipt.validation_errors).toEqual(['error1']);
    });
  });

  describe('serializeReceipt / parseReceipt', () => {
    it('round-trips receipt correctly', () => {
      const original = createReceipt(
        'event-456',
        { user_id: 'U789', channel_id: 'C012', message_ts: '1234567890.654321' },
        'idea',
        0.85,
        [],
        ['10-ideas/test.md'],
        'def456',
        'Test idea'
      );

      const serialized = serializeReceipt(original);
      const parsed = parseReceipt(serialized);

      expect(parsed.event_id).toBe(original.event_id);
      expect(parsed.classification).toBe(original.classification);
      expect(parsed.confidence).toBe(original.confidence);
      expect(parsed.commit_id).toBe(original.commit_id);
    });

    it('produces single-line JSON', () => {
      const receipt = createReceipt(
        'event-789',
        { user_id: 'U111', channel_id: 'C222', message_ts: '1234567890.111111' },
        'decision',
        0.95,
        [],
        [],
        null,
        'Test decision'
      );

      const serialized = serializeReceipt(receipt);
      expect(serialized).not.toContain('\n');
    });
  });
});

// ============================================================================
// System Prompt Loader Tests
// ============================================================================

describe('System Prompt Loader', () => {
  describe('computePromptHash', () => {
    it('computes SHA-256 hash', () => {
      const hash = computePromptHash('test content');
      expect(hash).toHaveLength(64); // SHA-256 hex is 64 chars
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('produces consistent hashes', () => {
      const hash1 = computePromptHash('same content');
      const hash2 = computePromptHash('same content');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different content', () => {
      const hash1 = computePromptHash('content A');
      const hash2 = computePromptHash('content B');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('validatePromptStructure', () => {
    it('validates prompt with all required sections', () => {
      const content = `
# System Prompt

## Role
You are an assistant.

## Classification Rules
- inbox: notes
- idea: insights

## Output Contract
Return JSON.
`;
      const result = validatePromptStructure(content);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('reports missing sections', () => {
      const content = `
# System Prompt

## Role
You are an assistant.
`;
      const result = validatePromptStructure(content);
      expect(result.valid).toBe(false);
      expect(result.missingSections).toContain('Classification Rules');
      expect(result.missingSections).toContain('Output Contract');
    });
  });
});

// ============================================================================
// Action Plan Tests
// ============================================================================

describe('Action Plan', () => {
  describe('validateActionPlan', () => {
    it('validates correct action plan', () => {
      const plan = {
        classification: 'inbox',
        confidence: 0.9,
        reasoning: 'This is a note',
        title: 'Test note',
        content: 'Note content',
        file_operations: [
          { operation: 'append', path: '00-inbox/2026-01-17.md', content: 'content' },
        ],
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects invalid classification', () => {
      const plan = {
        classification: 'invalid',
        confidence: 0.9,
        reasoning: 'Test',
        title: 'Test',
        content: 'Content',
        file_operations: [],
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'classification')).toBe(true);
    });

    it('rejects confidence out of range', () => {
      const plan = {
        classification: 'inbox',
        confidence: 1.5,
        reasoning: 'Test',
        title: 'Test',
        content: 'Content',
        file_operations: [],
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'confidence')).toBe(true);
    });

    it('rejects negative confidence', () => {
      const plan = {
        classification: 'inbox',
        confidence: -0.1,
        reasoning: 'Test',
        title: 'Test',
        content: 'Content',
        file_operations: [],
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(false);
    });

    it('allows missing task_details for task classification (lenient validation)', () => {
      // Task_details is now optional - we construct it from title if missing
      const plan = {
        classification: 'task',
        confidence: 0.9,
        reasoning: 'This is a task',
        title: 'Test task',
        content: 'Task content',
        file_operations: [],
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(true);
    });

    it('allows missing content for task classification (lenient validation)', () => {
      // Content is optional for tasks - we use title as fallback
      const plan = {
        classification: 'task',
        confidence: 0.9,
        reasoning: 'This is a task',
        title: 'Test task',
        file_operations: [],
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(true);
    });

    it('validates task with task_details', () => {
      const plan = {
        classification: 'task',
        confidence: 0.9,
        reasoning: 'This is a task',
        title: 'Test task',
        content: 'Task content',
        file_operations: [],
        task_details: { title: 'Do something' },
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(true);
    });

    it('validates file path prefixes', () => {
      const plan = {
        classification: 'idea',
        confidence: 0.9,
        reasoning: 'Test',
        title: 'Test',
        content: 'Content',
        file_operations: [
          { operation: 'create', path: '00-inbox/wrong.md', content: 'content' },
        ],
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('path'))).toBe(true);
    });
  });

  describe('parseActionPlanFromLLM', () => {
    it('parses JSON from code block', () => {
      const response = `Here is the action plan:
\`\`\`json
{"classification": "inbox", "confidence": 0.9, "reasoning": "test", "title": "test", "content": "test", "file_operations": []}
\`\`\``;

      const plan = parseActionPlanFromLLM(response);
      expect(plan).not.toBeNull();
      expect(plan?.classification).toBe('inbox');
    });

    it('parses raw JSON', () => {
      const response = '{"classification": "idea", "confidence": 0.85, "reasoning": "test", "title": "test", "content": "test", "file_operations": []}';

      const plan = parseActionPlanFromLLM(response);
      expect(plan).not.toBeNull();
      expect(plan?.classification).toBe('idea');
    });

    it('extracts JSON from mixed content', () => {
      const response = 'Some text before {"classification": "decision", "confidence": 0.95, "reasoning": "test", "title": "test", "content": "test", "file_operations": []} and after';

      const plan = parseActionPlanFromLLM(response);
      expect(plan).not.toBeNull();
      expect(plan?.classification).toBe('decision');
    });

    it('returns null for invalid JSON', () => {
      const response = 'This is not JSON at all';
      const plan = parseActionPlanFromLLM(response);
      expect(plan).toBeNull();
    });
  });

  describe('createDefaultActionPlan', () => {
    it('creates default inbox plan', () => {
      const plan = createDefaultActionPlan('Test message');
      expect(plan.classification).toBe('inbox');
      expect(plan.confidence).toBe(0.5);
      expect(plan.file_operations).toHaveLength(1);
      expect(plan.file_operations[0].operation).toBe('append');
    });

    it('uses specified classification', () => {
      const plan = createDefaultActionPlan('Test', 'idea');
      expect(plan.classification).toBe('idea');
    });
  });

  describe('requiresClarification', () => {
    it('returns true for low confidence', () => {
      const plan = { classification: 'inbox', confidence: 0.5 } as any;
      expect(requiresClarification(plan)).toBe(true);
    });

    it('returns false for high confidence', () => {
      const plan = { classification: 'inbox', confidence: 0.9 } as any;
      expect(requiresClarification(plan)).toBe(false);
    });

    it('uses custom threshold', () => {
      const plan = { classification: 'inbox', confidence: 0.75 } as any;
      expect(requiresClarification(plan, 0.8)).toBe(true);
      expect(requiresClarification(plan, 0.7)).toBe(false);
    });
  });

  describe('hasHighConfidence', () => {
    it('returns true for high confidence', () => {
      const plan = { classification: 'inbox', confidence: 0.9 } as any;
      expect(hasHighConfidence(plan)).toBe(true);
    });

    it('returns false for medium confidence', () => {
      const plan = { classification: 'inbox', confidence: 0.8 } as any;
      expect(hasHighConfidence(plan)).toBe(false);
    });

    it('uses custom threshold', () => {
      const plan = { classification: 'inbox', confidence: 0.8 } as any;
      expect(hasHighConfidence(plan, 0.75)).toBe(true);
      expect(hasHighConfidence(plan, 0.85)).toBe(false);
    });
  });
});


// ============================================================================
// AgentCore Client Tests
// ============================================================================

import {
  shouldAskClarification,
  generateClarificationPrompt,
  MockAgentCoreClient,
  CONFIDENCE_THRESHOLDS,
} from '../../src/components/agentcore-client';

describe('AgentCore Client', () => {
  describe('shouldAskClarification', () => {
    it('returns true for low confidence', () => {
      expect(shouldAskClarification(0.5, 'inbox')).toBe(true);
      expect(shouldAskClarification(0.69, 'idea')).toBe(true);
    });

    it('returns false for high confidence', () => {
      expect(shouldAskClarification(0.9, 'inbox')).toBe(false);
      expect(shouldAskClarification(0.85, 'idea')).toBe(false);
    });

    it('returns false for medium confidence inbox', () => {
      // Inbox is safe default, no clarification needed
      expect(shouldAskClarification(0.75, 'inbox')).toBe(false);
    });

    it('returns true for medium confidence non-inbox', () => {
      expect(shouldAskClarification(0.75, 'idea')).toBe(true);
      expect(shouldAskClarification(0.8, 'decision')).toBe(true);
    });

    it('uses correct thresholds', () => {
      expect(CONFIDENCE_THRESHOLDS.LOW).toBe(0.7);
      expect(CONFIDENCE_THRESHOLDS.HIGH).toBe(0.85);
    });
  });

  describe('generateClarificationPrompt', () => {
    it('generates prompt with options', () => {
      const prompt = generateClarificationPrompt('idea', 0.6);
      expect(prompt).toContain("I'm not sure how to classify this");
      expect(prompt).toContain('*idea*');
      expect(prompt).toContain('reclassify:');
    });

    it('includes alternative classifications', () => {
      const prompt = generateClarificationPrompt('task', 0.5, ['task', 'inbox', 'idea']);
      expect(prompt).toContain('*task*');
      expect(prompt).toContain('*inbox*');
      expect(prompt).toContain('*idea*');
    });
  });

  describe('MockAgentCoreClient', () => {
    it('returns default response', async () => {
      const client = new MockAgentCoreClient();
      const result = await client.invoke({
        prompt: 'Test message',
        system_prompt: 'Test prompt',
      });

      expect(result.success).toBe(true);
      expect(result.actionPlan?.classification).toBe('inbox');
    });

    it('returns custom response for pattern', async () => {
      const client = new MockAgentCoreClient();
      client.setResponse('special', {
        success: true,
        actionPlan: {
          classification: 'idea',
          confidence: 0.95,
          reasoning: 'Custom response',
          title: 'Special idea',
          content: 'Content',
          intent: 'capture',
          intent_confidence: 0.9,
          file_operations: [],
        },
      });

      const result = await client.invoke({
        prompt: 'This is a special message',
        system_prompt: 'Test',
      });

      expect(result.actionPlan?.classification).toBe('idea');
      expect(result.actionPlan?.confidence).toBe(0.95);
    });

    it('clears responses', async () => {
      const client = new MockAgentCoreClient();
      client.setResponse('test', { success: false, error: 'Error' });
      client.clear();

      const result = await client.invoke({
        prompt: 'test message',
        system_prompt: 'Test',
      });

      // Should return default, not the cleared response
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// Task Router Tests
// ============================================================================

import { formatTaskEmail } from '../../src/components/task-router';

describe('Task Router', () => {
  describe('formatTaskEmail', () => {
    it('formats task email with title and context', () => {
      const email = formatTaskEmail(
        'Review the budget',
        'Q1 budget needs review',
        { userId: 'U123', channelId: 'C456', messageTs: '1234567890.123456' }
      );

      expect(email.subject).toBe('Review the budget');
      expect(email.body).toContain('Q1 budget needs review');
      expect(email.body).toContain('Source: Slack DM');
    });

    it('removes "I need to" prefix', () => {
      const email = formatTaskEmail(
        'I need to review the budget',
        '',
        { userId: 'U123', channelId: 'C456', messageTs: '123' }
      );

      expect(email.subject).toBe('Review the budget');
    });

    it('removes "should" prefix', () => {
      const email = formatTaskEmail(
        'should call the client',
        '',
        { userId: 'U123', channelId: 'C456', messageTs: '123' }
      );

      expect(email.subject).toBe('Call the client');
    });

    it('capitalizes first letter', () => {
      const email = formatTaskEmail(
        'review the budget',
        '',
        { userId: 'U123', channelId: 'C456', messageTs: '123' }
      );

      expect(email.subject).toBe('Review the budget');
    });

    it('includes Slack source reference', () => {
      const email = formatTaskEmail(
        'Test task',
        '',
        { userId: 'U123', channelId: 'C456', messageTs: '1234567890.123456' }
      );

      expect(email.body).toContain('User: U123');
      expect(email.body).toContain('Timestamp: 1234567890.123456');
    });
  });
});

// ============================================================================
// Slack Responder Tests
// ============================================================================

import {
  formatConfirmationReply,
  formatClarificationReply,
  formatErrorReply,
} from '../../src/components/slack-responder';

describe('Slack Responder', () => {
  describe('formatConfirmationReply', () => {
    it('formats inbox confirmation', () => {
      const reply = formatConfirmationReply(
        'inbox',
        ['00-inbox/2026-01-17.md'],
        'abc1234'
      );

      expect(reply).toContain('*inbox*');
      expect(reply).toContain('00-inbox/2026-01-17.md');
      expect(reply).toContain('abc1234');
      expect(reply).toContain('fix:');
    });

    it('formats task confirmation with email', () => {
      const reply = formatConfirmationReply(
        'task',
        [],
        null,
        { taskTitle: 'Review budget', emailSent: true }
      );

      expect(reply).toContain('*task*');
      expect(reply).toContain('OmniFocus');
      expect(reply).toContain('Review budget');
    });

    it('formats fix confirmation', () => {
      const reply = formatConfirmationReply(
        'fix',
        ['10-ideas/test.md'],
        'def5678'
      );

      expect(reply).toContain('Fix applied');
      expect(reply).toContain('def5678');
    });
  });

  describe('formatClarificationReply', () => {
    it('formats clarification with options', () => {
      const reply = formatClarificationReply(
        "I'm not sure how to classify this.",
        ['inbox', 'idea', 'task']
      );

      expect(reply).toContain('*inbox*');
      expect(reply).toContain('*idea*');
      expect(reply).toContain('*task*');
      expect(reply).toContain('reclassify:');
    });

    it('includes descriptions for options', () => {
      const reply = formatClarificationReply('Question', ['decision']);
      expect(reply).toContain("commitment you've made");
    });
  });

  describe('formatErrorReply', () => {
    it('formats error message', () => {
      const reply = formatErrorReply('Something went wrong');
      expect(reply).toContain("couldn't process");
      expect(reply).toContain('Something went wrong');
    });

    it('includes details when provided', () => {
      const reply = formatErrorReply('Error', ['detail1', 'detail2']);
      expect(reply).toContain('detail1');
      expect(reply).toContain('detail2');
    });
  });
});

// ============================================================================
// Conversation Context Tests
// ============================================================================

import {
  generateSessionId,
  parseSessionId,
} from '../../src/components/conversation-context';

describe('Conversation Context', () => {
  describe('generateSessionId', () => {
    it('generates session ID from channel and user', () => {
      const sessionId = generateSessionId('C123', 'U456');
      expect(sessionId).toBe('C123#U456');
    });
  });

  describe('parseSessionId', () => {
    it('parses session ID to channel and user', () => {
      const { channelId, userId } = parseSessionId('C123#U456');
      expect(channelId).toBe('C123');
      expect(userId).toBe('U456');
    });
  });
});


// ============================================================================
// Fix Handler Tests
// ============================================================================

import {
  parseFixCommand,
  isFixCommand,
  canApplyFix,
} from '../../src/components/fix-handler';

describe('Fix Handler', () => {
  describe('parseFixCommand', () => {
    it('parses fix: prefix with colon', () => {
      const result = parseFixCommand('fix: change the title');
      expect(result.isFixCommand).toBe(true);
      expect(result.instruction).toBe('change the title');
    });

    it('parses FIX: prefix case-insensitive', () => {
      const result = parseFixCommand('FIX: update content');
      expect(result.isFixCommand).toBe(true);
      expect(result.instruction).toBe('update content');
    });

    it('parses Fix: prefix mixed case', () => {
      const result = parseFixCommand('Fix: correct spelling');
      expect(result.isFixCommand).toBe(true);
      expect(result.instruction).toBe('correct spelling');
    });

    it('parses fix without colon', () => {
      const result = parseFixCommand('fix change the title');
      expect(result.isFixCommand).toBe(true);
      expect(result.instruction).toBe('change the title');
    });

    it('returns false for non-fix messages', () => {
      const result = parseFixCommand('Hello world');
      expect(result.isFixCommand).toBe(false);
      expect(result.instruction).toBe('');
    });

    it('returns false for empty string', () => {
      const result = parseFixCommand('');
      expect(result.isFixCommand).toBe(false);
    });

    it('trims whitespace from instruction', () => {
      const result = parseFixCommand('fix:   lots of spaces   ');
      expect(result.instruction).toBe('lots of spaces');
    });
  });

  describe('isFixCommand', () => {
    it('returns true for fix commands', () => {
      expect(isFixCommand('fix: something')).toBe(true);
      expect(isFixCommand('FIX: something')).toBe(true);
      expect(isFixCommand('fix something')).toBe(true);
    });

    it('returns false for non-fix messages', () => {
      expect(isFixCommand('hello')).toBe(false);
      expect(isFixCommand('fixing something')).toBe(false);
    });
  });

  describe('canApplyFix', () => {
    it('returns false for null receipt', () => {
      const result = canApplyFix(null);
      expect(result.canFix).toBe(false);
      expect(result.reason).toContain('No recent entry');
    });

    it('returns false for fix receipt', () => {
      const receipt = {
        classification: 'fix' as const,
        commit_id: 'abc123',
        files: ['test.md'],
      } as any;
      const result = canApplyFix(receipt);
      expect(result.canFix).toBe(false);
      expect(result.reason).toContain('Cannot fix a fix');
    });

    it('returns false for task receipt', () => {
      const receipt = {
        classification: 'task' as const,
        commit_id: 'abc123',
        files: [],
      } as any;
      const result = canApplyFix(receipt);
      expect(result.canFix).toBe(false);
      expect(result.reason).toContain('task');
    });

    it('returns false for receipt without commit', () => {
      const receipt = {
        classification: 'inbox' as const,
        commit_id: null,
        files: ['test.md'],
      } as any;
      const result = canApplyFix(receipt);
      expect(result.canFix).toBe(false);
      expect(result.reason).toContain('No commit');
    });

    it('returns true for valid fixable receipt', () => {
      const receipt = {
        classification: 'inbox' as const,
        commit_id: 'abc123',
        files: ['00-inbox/2026-01-17.md'],
      } as any;
      const result = canApplyFix(receipt);
      expect(result.canFix).toBe(true);
    });
  });
});

// ============================================================================
// Markdown Templates Tests
// ============================================================================

import {
  formatISODate,
  formatISOTime,
  sanitizeForMarkdown,
  generateInboxEntry,
  generateInboxHeader,
  generateIdeaNote,
  generateDecisionNote,
  generateProjectPage,
} from '../../src/components/markdown-templates';

describe('Markdown Templates', () => {
  describe('formatISODate', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date('2026-01-17T12:30:00Z');
      expect(formatISODate(date)).toBe('2026-01-17');
    });
  });

  describe('formatISOTime', () => {
    it('formats time as HH:MM', () => {
      const date = new Date('2026-01-17T12:30:45Z');
      expect(formatISOTime(date)).toBe('12:30');
    });
  });

  describe('sanitizeForMarkdown', () => {
    it('removes emoji characters', () => {
      const result = sanitizeForMarkdown('Hello 👋 World 🌍');
      expect(result).toBe('Hello World');
    });

    it('normalizes whitespace', () => {
      const result = sanitizeForMarkdown('Hello   World\n\nTest');
      expect(result).toBe('Hello World Test');
    });

    it('preserves regular text', () => {
      const result = sanitizeForMarkdown('Normal text here');
      expect(result).toBe('Normal text here');
    });
  });

  describe('generateInboxEntry', () => {
    it('generates entry with timestamp', () => {
      const entry = generateInboxEntry({
        text: 'Test note',
        timestamp: new Date('2026-01-17T14:30:00Z'),
      });
      expect(entry).toContain('14:30');
      expect(entry).toContain('Test note');
    });

    it('includes classification hint when provided', () => {
      const entry = generateInboxEntry({
        text: 'Test note',
        timestamp: new Date(),
        classificationHint: 'idea',
      });
      expect(entry).toContain('[hint: idea]');
    });

    it('does not include hint for inbox classification', () => {
      const entry = generateInboxEntry({
        text: 'Test note',
        timestamp: new Date(),
        classificationHint: 'inbox',
      });
      expect(entry).not.toContain('[hint:');
    });
  });

  describe('generateInboxHeader', () => {
    it('generates header with date', () => {
      const header = generateInboxHeader(new Date('2026-01-17'));
      expect(header).toBe('# 2026-01-17\n\n');
    });
  });

  describe('generateIdeaNote', () => {
    it('generates idea note with all sections', () => {
      const note = generateIdeaNote({
        title: 'Test Idea',
        context: 'Some context here',
        keyPoints: ['Point 1', 'Point 2'],
        implications: ['Implication 1'],
        openQuestions: ['Question 1'],
      });

      expect(note).toContain('# Test Idea');
      expect(note).toContain('## Context');
      expect(note).toContain('Some context here');
      expect(note).toContain('## Key Points');
      expect(note).toContain('- Point 1');
      expect(note).toContain('## Implications');
      expect(note).toContain('## Open Questions');
      expect(note).toContain('Source: Slack DM');
    });

    it('omits optional sections when empty', () => {
      const note = generateIdeaNote({
        title: 'Simple Idea',
        context: 'Context',
        keyPoints: ['Point'],
      });

      expect(note).not.toContain('## Implications');
      expect(note).not.toContain('## Open Questions');
    });
  });

  describe('generateDecisionNote', () => {
    it('generates decision note with all sections', () => {
      const note = generateDecisionNote({
        decision: 'Use TypeScript',
        date: new Date('2026-01-17'),
        rationale: 'Better type safety',
        alternatives: ['JavaScript', 'Python'],
        consequences: ['Learning curve'],
      });

      expect(note).toContain('# Decision: Use TypeScript');
      expect(note).toContain('Date: 2026-01-17');
      expect(note).toContain('## Rationale');
      expect(note).toContain('Better type safety');
      expect(note).toContain('## Alternatives Considered');
      expect(note).toContain('- JavaScript');
      expect(note).toContain('## Consequences');
      expect(note).toContain('Source: Slack DM');
    });
  });

  describe('generateProjectPage', () => {
    it('generates project page with all sections', () => {
      const page = generateProjectPage({
        title: 'Test Project',
        objective: 'Build something great',
        status: 'active',
        keyDecisions: ['20-decisions/2026-01-17-use-typescript.md'],
        nextSteps: ['Step 1', 'Step 2'],
        references: ['Reference 1'],
      });

      expect(page).toContain('# Project: Test Project');
      expect(page).toContain('Status: active');
      expect(page).toContain('## Objective');
      expect(page).toContain('Build something great');
      expect(page).toContain('## Key Decisions');
      expect(page).toContain('[[20-decisions/2026-01-17-use-typescript.md]]');
      expect(page).toContain('## Next Steps');
      expect(page).toContain('## References');
      expect(page).toContain('Source: Slack DM');
    });
  });
});

// ============================================================================
// Logging Tests
// ============================================================================

import { redactPII, redactSensitiveFields } from '../../src/handlers/logging';

describe('Logging', () => {
  describe('redactPII', () => {
    it('redacts email addresses', () => {
      const result = redactPII('Contact me at test@example.com');
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('test@example.com');
    });

    it('redacts phone numbers', () => {
      const result = redactPII('Call me at 555-123-4567');
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('555-123-4567');
    });

    it('preserves non-PII text', () => {
      const result = redactPII('Hello world');
      expect(result).toBe('Hello world');
    });
  });

  describe('redactSensitiveFields', () => {
    it('redacts sensitive field names', () => {
      const result = redactSensitiveFields({
        user_id: 'U123',
        message_text: 'Secret message',
        password: 'secret123',
      });

      expect(result.user_id).toBe('U123');
      expect(result.message_text).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
    });

    it('handles nested objects', () => {
      const result = redactSensitiveFields({
        outer: {
          email: 'test@example.com',
          name: 'Test',
        },
      });

      expect((result.outer as any).email).toBe('[REDACTED]');
      expect((result.outer as any).name).toBe('Test');
    });
  });
});
