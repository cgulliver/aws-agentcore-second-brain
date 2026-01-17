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

    it('requires task_details for task classification', () => {
      const plan = {
        classification: 'task',
        confidence: 0.9,
        reasoning: 'This is a task',
        title: 'Test task',
        content: 'Task content',
        file_operations: [],
      };

      const result = validateActionPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'task_details')).toBe(true);
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
