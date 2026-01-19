/**
 * Type validation tests
 * 
 * Validates: Requirements 6, 42, 43 (Classification, Action Plan)
 */

import { describe, it, expect } from 'vitest';
import {
  isValidClassification,
  CLASSIFICATIONS,
  getConfidenceLevel,
  DEFAULT_CONFIDENCE_THRESHOLDS,
} from '../../src/types/classification';
import {
  validateActionPlan,
  parseActionPlanFromLLM,
} from '../../src/types/action-plan';
import {
  isValidReceipt,
  serializeReceipt,
  parseReceipt,
} from '../../src/types/receipt';
import {
  createExecutionRecord,
  getCompletedSteps,
  canRetry,
} from '../../src/types/execution';

describe('Classification Types', () => {
  it('should have 5 valid classifications', () => {
    expect(CLASSIFICATIONS).toHaveLength(5);
    expect(CLASSIFICATIONS).toContain('inbox');
    expect(CLASSIFICATIONS).toContain('idea');
    expect(CLASSIFICATIONS).toContain('decision');
    expect(CLASSIFICATIONS).toContain('project');
    expect(CLASSIFICATIONS).toContain('task');
  });

  it('should validate classification strings', () => {
    expect(isValidClassification('inbox')).toBe(true);
    expect(isValidClassification('idea')).toBe(true);
    expect(isValidClassification('invalid')).toBe(false);
    expect(isValidClassification('')).toBe(false);
  });

  it('should determine confidence levels correctly', () => {
    expect(getConfidenceLevel(0.9)).toBe('high');
    expect(getConfidenceLevel(0.85)).toBe('high');
    expect(getConfidenceLevel(0.8)).toBe('medium');
    expect(getConfidenceLevel(0.7)).toBe('medium');
    expect(getConfidenceLevel(0.5)).toBe('low');
    expect(getConfidenceLevel(0.0)).toBe('low');
  });
});

describe('Action Plan Validation', () => {
  const validActionPlan = {
    intent: 'capture',
    intent_confidence: 0.95,
    classification: 'inbox',
    confidence: 0.9,
    needs_clarification: false,
    file_operations: [
      {
        path: '00-inbox/2026-01-17.md',
        operation: 'append',
        content: '- 10:30 — Test message',
      },
    ],
    commit_message: 'Add inbox entry',
    slack_reply_text: 'Captured as inbox',
  };

  const validQueryPlan = {
    intent: 'query',
    intent_confidence: 0.92,
    classification: null,
    confidence: 0,
    needs_clarification: false,
    file_operations: [],
    commit_message: '',
    slack_reply_text: 'Here is what I found...',
    query_response: 'Based on your knowledge base, you have 3 decisions about budgets.',
    cited_files: ['20-decisions/2026-01-10-q1-budget.md'],
  };

  it('should validate a correct capture action plan', () => {
    const result = validateActionPlan(validActionPlan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate a correct query action plan', () => {
    const result = validateActionPlan(validQueryPlan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid intent', () => {
    const invalid = { ...validActionPlan, intent: 'invalid' };
    const result = validateActionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('intent'))).toBe(true);
  });

  it('should reject invalid classification', () => {
    const invalid = { ...validActionPlan, classification: 'invalid' };
    const result = validateActionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('classification'))).toBe(true);
  });

  it('should reject confidence out of bounds', () => {
    const invalid = { ...validActionPlan, confidence: 1.5 };
    const result = validateActionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('confidence'))).toBe(true);
  });

  it('should require clarification_prompt when needs_clarification is true', () => {
    const invalid = { ...validActionPlan, needs_clarification: true };
    const result = validateActionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('clarification_prompt'))).toBe(true);
  });

  it('should validate file path matches classification', () => {
    const invalid = {
      ...validActionPlan,
      classification: 'idea',
      file_operations: [
        {
          path: '00-inbox/test.md', // Wrong path for idea
          operation: 'create',
          content: 'test',
        },
      ],
    };
    const result = validateActionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('10-ideas'))).toBe(true);
  });

  it('should reject file_operations for query intent', () => {
    const invalid = {
      ...validQueryPlan,
      file_operations: [{ path: 'test.md', operation: 'create', content: 'test' }],
    };
    const result = validateActionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('file_operations must be empty for query'))).toBe(true);
  });

  it('should require query_response for query intent', () => {
    const { query_response, ...invalid } = validQueryPlan;
    const result = validateActionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('query_response is required'))).toBe(true);
  });

  it('should require cited_files for query intent', () => {
    const { cited_files, ...invalid } = validQueryPlan;
    const result = validateActionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cited_files must be an array'))).toBe(true);
  });
});

describe('Action Plan Parsing', () => {
  it('should parse valid JSON', () => {
    const json = JSON.stringify({
      intent: 'capture',
      intent_confidence: 0.95,
      classification: 'inbox',
      confidence: 0.9,
      needs_clarification: false,
      file_operations: [],
      commit_message: 'test',
      slack_reply_text: 'test',
    });
    const result = parseActionPlanFromLLM(json);
    expect(result).not.toBeNull();
    expect(result?.classification).toBe('inbox');
    expect(result?.intent).toBe('capture');
  });

  it('should extract JSON from markdown code block', () => {
    const wrapped = '```json\n{"intent":"capture","intent_confidence":0.95,"classification":"inbox","confidence":0.9,"needs_clarification":false,"file_operations":[],"commit_message":"test","slack_reply_text":"test"}\n```';
    const result = parseActionPlanFromLLM(wrapped);
    expect(result).not.toBeNull();
    expect(result?.classification).toBe('inbox');
    expect(result?.intent).toBe('capture');
  });

  it('should return null for invalid JSON', () => {
    const result = parseActionPlanFromLLM('not json');
    expect(result).toBeNull();
  });
});

describe('Receipt Validation', () => {
  const validReceipt = {
    timestamp_iso: '2026-01-17T10:30:00Z',
    event_id: 'Ev123456',
    slack: {
      user_id: 'U123',
      channel_id: 'D456',
      message_ts: '1737159910.123456',
    },
    classification: 'inbox' as const,
    confidence: 0.9,
    actions: [],
    files: ['00-inbox/2026-01-17.md'],
    commit_id: 'abc123',
    prior_commit_id: null,
    prompt_commit_id: 'def456',
    prompt_sha256: 'sha256hash',
    summary: 'Captured inbox entry',
  };

  it('should validate a correct receipt', () => {
    expect(isValidReceipt(validReceipt)).toBe(true);
  });

  it('should reject receipt with missing fields', () => {
    const { event_id, ...invalid } = validReceipt;
    expect(isValidReceipt(invalid)).toBe(false);
  });

  it('should serialize and parse receipt correctly', () => {
    const serialized = serializeReceipt(validReceipt);
    const parsed = parseReceipt(serialized);
    expect(parsed.event_id).toBe(validReceipt.event_id);
    expect(parsed.classification).toBe(validReceipt.classification);
  });
});

describe('Execution State', () => {
  it('should create initial execution record', () => {
    const record = createExecutionRecord('Ev123456');
    expect(record.event_id).toBe('Ev123456');
    expect(record.status).toBe('RECEIVED');
    expect(record.codecommit_status).toBe('pending');
    expect(record.ses_status).toBe('pending');
    expect(record.slack_status).toBe('pending');
    expect(record.expires_at).toBeGreaterThan(Date.now() / 1000);
  });

  it('should identify completed steps', () => {
    const record = createExecutionRecord('Ev123456');
    record.codecommit_status = 'succeeded';
    record.ses_status = 'failed';
    
    const completed = getCompletedSteps(record);
    expect(completed.has('codecommit_status')).toBe(true);
    expect(completed.has('ses_status')).toBe(false);
    expect(completed.has('slack_status')).toBe(false);
  });

  it('should determine retry eligibility', () => {
    const record = createExecutionRecord('Ev123456');
    expect(canRetry(record)).toBe(false);
    
    record.status = 'PARTIAL_FAILURE';
    expect(canRetry(record)).toBe(true);
    
    record.status = 'SUCCEEDED';
    expect(canRetry(record)).toBe(false);
  });
});
