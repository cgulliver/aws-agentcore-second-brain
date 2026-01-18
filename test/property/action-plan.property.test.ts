/**
 * Property-Based Tests: Action Plan Validation
 * 
 * Validates: Requirements 6.1, 6.2, 42, 43 (Classification and Confidence)
 * 
 * Property 6: Classification is always one of valid types
 * Property 7: Confidence is always in [0, 1] range
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateActionPlan, type ActionPlan } from '../../src/components/action-plan';

// Valid classifications
const VALID_CLASSIFICATIONS = ['inbox', 'idea', 'decision', 'project', 'task'] as const;

// Arbitrary for valid action plans
const validActionPlanArbitrary = fc.record({
  classification: fc.constantFrom(...VALID_CLASSIFICATIONS),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  reasoning: fc.string({ minLength: 1, maxLength: 200 }),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  content: fc.string({ minLength: 1, maxLength: 500 }),
  file_operations: fc.array(
    fc.record({
      operation: fc.constantFrom('create', 'append', 'update'),
      path: fc.string({ minLength: 5, maxLength: 50 }).map(s => `00-inbox/${s}.md`),
      content: fc.string({ minLength: 1, maxLength: 200 }),
    }),
    { minLength: 0, maxLength: 3 }
  ),
}) as fc.Arbitrary<ActionPlan>;

describe('Property 6: Classification Type Invariant', () => {
  /**
   * Property: Valid classifications are accepted
   */
  it('should accept all valid classification types', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_CLASSIFICATIONS),
        (classification) => {
          const plan: ActionPlan = {
            classification,
            confidence: 0.9,
            reasoning: 'Test',
            title: 'Test',
            content: 'Content',
            file_operations: [],
            ...(classification === 'task' ? { task_details: { title: 'Task' } } : {}),
          };

          const result = validateActionPlan(plan);
          const hasClassificationError = result.errors.some(e => e.field === 'classification');
          expect(hasClassificationError).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Invalid classifications are rejected
   */
  it('should reject invalid classification types', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          s => !VALID_CLASSIFICATIONS.includes(s as any)
        ),
        (classification) => {
          const plan = {
            classification,
            confidence: 0.9,
            reasoning: 'Test',
            title: 'Test',
            content: 'Content',
            file_operations: [],
          } as unknown as ActionPlan;

          const result = validateActionPlan(plan);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'classification')).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 7: Confidence Bounds Invariant', () => {
  /**
   * Property: Confidence in [0, 1] is accepted
   */
  it('should accept confidence values in [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        (confidence) => {
          const plan: ActionPlan = {
            classification: 'inbox',
            confidence,
            reasoning: 'Test',
            title: 'Test',
            content: 'Content',
            file_operations: [],
          };

          const result = validateActionPlan(plan);
          const hasConfidenceError = result.errors.some(e => e.field === 'confidence');
          expect(hasConfidenceError).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Confidence > 1 is rejected
   */
  it('should reject confidence values > 1', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1.01, max: 100, noNaN: true }),
        (confidence) => {
          const plan: ActionPlan = {
            classification: 'inbox',
            confidence,
            reasoning: 'Test',
            title: 'Test',
            content: 'Content',
            file_operations: [],
          };

          const result = validateActionPlan(plan);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Confidence < 0 is rejected
   */
  it('should reject confidence values < 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: -0.01, noNaN: true }),
        (confidence) => {
          const plan: ActionPlan = {
            classification: 'inbox',
            confidence,
            reasoning: 'Test',
            title: 'Test',
            content: 'Content',
            file_operations: [],
          };

          const result = validateActionPlan(plan);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Boundary values 0 and 1 are accepted
   */
  it('should accept boundary values 0 and 1', () => {
    const plan0: ActionPlan = {
      classification: 'inbox',
      confidence: 0,
      reasoning: 'Test',
      title: 'Test',
      content: 'Content',
      file_operations: [],
    };

    const plan1: ActionPlan = {
      classification: 'inbox',
      confidence: 1,
      reasoning: 'Test',
      title: 'Test',
      content: 'Content',
      file_operations: [],
    };

    expect(validateActionPlan(plan0).errors.some(e => e.field === 'confidence')).toBe(false);
    expect(validateActionPlan(plan1).errors.some(e => e.field === 'confidence')).toBe(false);
  });
});

describe('Action Plan Validation Properties', () => {
  /**
   * Property: Valid action plans pass validation
   */
  it('should accept valid action plans', () => {
    fc.assert(
      fc.property(validActionPlanArbitrary, (plan) => {
        // Add task_details if classification is task
        if (plan.classification === 'task') {
          plan.task_details = { title: 'Task title' };
        }
        
        // Fix file paths to match classification
        if (plan.file_operations.length > 0) {
          const prefix = plan.classification === 'inbox' ? '00-inbox' :
                        plan.classification === 'idea' ? '10-ideas' :
                        plan.classification === 'decision' ? '20-decisions' :
                        plan.classification === 'project' ? '30-projects' : '00-inbox';
          plan.file_operations = plan.file_operations.map(op => ({
            ...op,
            path: `${prefix}/test.md`,
          }));
        }

        const result = validateActionPlan(plan);
        // Should have no classification or confidence errors
        const criticalErrors = result.errors.filter(
          e => e.field === 'classification' || e.field === 'confidence'
        );
        expect(criticalErrors).toHaveLength(0);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Validation is deterministic
   */
  it('should produce consistent validation results', () => {
    fc.assert(
      fc.property(validActionPlanArbitrary, (plan) => {
        const result1 = validateActionPlan(plan);
        const result2 = validateActionPlan(plan);
        
        expect(result1.valid).toBe(result2.valid);
        expect(result1.errors.length).toBe(result2.errors.length);
      }),
      { numRuns: 50 }
    );
  });
});
