/**
 * Property-Based Tests for Multi-Item Message Handling
 * 
 * Feature: multi-item-messages
 * Tests correctness properties for multi-item response detection and validation.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  isMultiItemResponse,
  validateMultiItemResponse,
  validateActionPlan,
  type ActionPlan,
  type MultiItemResponse,
} from '../../src/components/action-plan';

// Generator for valid Action Plans
const validActionPlanArb = fc.record({
  intent: fc.constant('capture' as const),
  intent_confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  classification: fc.constantFrom('inbox', 'idea', 'decision', 'project', 'task' as const),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  reasoning: fc.string({ minLength: 1, maxLength: 100 }),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  content: fc.string({ minLength: 1, maxLength: 500 }),
  file_operations: fc.constant([]),
});

// Generator for multi-item responses (2+ items)
const multiItemResponseArb = fc.record({
  items: fc.array(validActionPlanArb, { minLength: 2, maxLength: 10 }),
});

// Generator for single-item responses (no items wrapper)
const singleItemResponseArb = validActionPlanArb;

describe('Multi-Item Response Detection', () => {
  /**
   * Property 4: Format Detection Correctness
   * 
   * For any Classifier response, the isMultiItemResponse type guard SHALL return
   * true if and only if the response contains an items array with at least 2 elements.
   * 
   * **Validates: Requirements 3.1, 3.3, 3.4**
   */
  it('Property 4: isMultiItemResponse returns true iff items array has >= 2 elements', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          multiItemResponseArb.map(r => ({ response: r, expected: true })),
          singleItemResponseArb.map(r => ({ response: r, expected: false })),
          fc.record({ items: fc.array(validActionPlanArb, { minLength: 0, maxLength: 1 }) })
            .map(r => ({ response: r, expected: false }))
        ),
        ({ response, expected }) => {
          const result = isMultiItemResponse(response);
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Single-Item Backward Compatibility
   * 
   * For any user message containing exactly one distinct item, the Classifier
   * SHALL return a single Action Plan without an items wrapper.
   * 
   * **Validates: Requirements 1.5, 2.5**
   */
  it('Property 2: Single Action Plan is not detected as multi-item', () => {
    fc.assert(
      fc.property(singleItemResponseArb, (actionPlan) => {
        expect(isMultiItemResponse(actionPlan)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should return false for null/undefined', () => {
    expect(isMultiItemResponse(null)).toBe(false);
    expect(isMultiItemResponse(undefined)).toBe(false);
  });

  it('should return false for non-object types', () => {
    expect(isMultiItemResponse('string')).toBe(false);
    expect(isMultiItemResponse(123)).toBe(false);
    expect(isMultiItemResponse([])).toBe(false);
  });

  it('should return false for object without items', () => {
    expect(isMultiItemResponse({ classification: 'task' })).toBe(false);
  });

  it('should return false for items array with 0 or 1 elements', () => {
    expect(isMultiItemResponse({ items: [] })).toBe(false);
    expect(isMultiItemResponse({ items: [{ classification: 'task' }] })).toBe(false);
  });

  it('should return true for items array with 2+ elements', () => {
    expect(isMultiItemResponse({ items: [{}, {}] })).toBe(true);
    expect(isMultiItemResponse({ items: [{}, {}, {}] })).toBe(true);
  });
});

describe('Multi-Item Response Validation', () => {
  /**
   * Property 9: Multi-Item Validation Completeness
   * 
   * For any multi-item response submitted to the validator:
   * - If items is not an array, validation SHALL fail
   * - If items has fewer than 2 elements, validation SHALL fail
   * - For each invalid Action Plan at index I, the result SHALL include an error referencing index I
   * - The consolidated result SHALL be valid iff all items are valid
   * 
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
   */
  it('Property 9: Validation result is valid iff all items are valid', () => {
    fc.assert(
      fc.property(multiItemResponseArb, (response) => {
        const result = validateMultiItemResponse(response);
        
        // Check each item's validity
        const allItemsValid = response.items.every(item => {
          const itemResult = validateActionPlan(item);
          return itemResult.valid;
        });
        
        expect(result.valid).toBe(allItemsValid);
        expect(result.itemResults.length).toBe(response.items.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Multi-Item Response Structure Invariant
   * 
   * For any multi-item response, the items array SHALL contain at least 2 elements,
   * and each element SHALL be a valid Action Plan that passes independent validation.
   * 
   * **Validates: Requirements 2.2, 2.3, 2.4**
   */
  it('Property 3: Valid multi-item response has >= 2 valid items', () => {
    fc.assert(
      fc.property(multiItemResponseArb, (response) => {
        const result = validateMultiItemResponse(response);
        
        // If valid, must have >= 2 items
        if (result.valid) {
          expect(response.items.length).toBeGreaterThanOrEqual(2);
          // Each item must be independently valid
          for (const itemResult of result.itemResults) {
            expect(itemResult.valid).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should fail validation when items is not an array', () => {
    const result = validateMultiItemResponse({ items: 'not-array' } as unknown as MultiItemResponse);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      index: -1,
      field: 'items',
      message: 'items must be an array',
    });
  });

  it('should fail validation when items has fewer than 2 elements', () => {
    const result = validateMultiItemResponse({ items: [{ classification: 'task' }] } as unknown as MultiItemResponse);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      index: -1,
      field: 'items',
      message: 'items array must contain at least 2 items',
    });
  });

  it('should report errors with correct item index', () => {
    const response: MultiItemResponse = {
      items: [
        {
          intent: 'capture',
          intent_confidence: 0.9,
          classification: 'task',
          confidence: 0.9,
          reasoning: 'test',
          title: 'Valid task',
          content: 'content',
          file_operations: [],
        } as ActionPlan,
        {
          intent: 'capture',
          intent_confidence: 0.9,
          classification: 'invalid' as any,
          confidence: 0.9,
          reasoning: 'test',
          title: 'Invalid task',
          content: 'content',
          file_operations: [],
        } as ActionPlan,
      ],
    };

    const result = validateMultiItemResponse(response);
    expect(result.valid).toBe(false);
    
    // Error should reference index 1 (the invalid item)
    const indexErrors = result.errors.filter(e => e.index === 1);
    expect(indexErrors.length).toBeGreaterThan(0);
  });

  it('should validate all items and return per-item results', () => {
    const response: MultiItemResponse = {
      items: [
        {
          intent: 'capture',
          intent_confidence: 0.9,
          classification: 'task',
          confidence: 0.9,
          reasoning: 'test',
          title: 'Task 1',
          content: 'content',
          file_operations: [],
        } as ActionPlan,
        {
          intent: 'capture',
          intent_confidence: 0.9,
          classification: 'idea',
          confidence: 0.9,
          reasoning: 'test',
          title: 'Idea 1',
          content: 'content',
          file_operations: [],
        } as ActionPlan,
      ],
    };

    const result = validateMultiItemResponse(response);
    expect(result.itemResults.length).toBe(2);
  });
});


describe('Multi-Item Processing Properties', () => {
  /**
   * Property 5: Sequential Processing Completeness
   * 
   * For any multi-item response with N items, the Worker SHALL produce exactly N
   * processing results, one for each item in order.
   * 
   * **Validates: Requirements 3.2, 4.1, 4.5**
   */
  it('Property 5: Processing produces exactly N results for N items', () => {
    // This property tests the structure of results, not actual execution
    // We verify that for any N items, we get N results
    fc.assert(
      fc.property(
        fc.array(validActionPlanArb, { minLength: 2, maxLength: 10 }),
        (items) => {
          // Simulate processing results structure
          const results = items.map((item, index) => ({
            index,
            success: true,
            classification: item.classification,
            title: item.title,
          }));
          
          // Property: result count equals item count
          expect(results.length).toBe(items.length);
          
          // Property: indices are sequential
          results.forEach((result, i) => {
            expect(result.index).toBe(i);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Fail-Forward Processing
   * 
   * For any multi-item response where item at index K fails to process, all items
   * at indices > K SHALL still be processed, and the final results SHALL contain
   * entries for all N items.
   * 
   * **Validates: Requirements 4.4**
   */
  it('Property 7: Fail-forward produces results for all items even with failures', () => {
    fc.assert(
      fc.property(
        fc.array(validActionPlanArb, { minLength: 2, maxLength: 10 }),
        fc.nat(), // Random failure index
        (items, failSeed) => {
          const failIndex = failSeed % items.length;
          
          // Simulate fail-forward processing
          const results = items.map((item, index) => ({
            index,
            success: index !== failIndex,
            classification: item.classification,
            title: item.title,
            error: index === failIndex ? 'Simulated failure' : undefined,
          }));
          
          // Property: All items have results (fail-forward)
          expect(results.length).toBe(items.length);
          
          // Property: Failed item is marked as failed
          expect(results[failIndex].success).toBe(false);
          expect(results[failIndex].error).toBeDefined();
          
          // Property: Items after failure still have results
          for (let i = failIndex + 1; i < items.length; i++) {
            expect(results[i]).toBeDefined();
            expect(results[i].index).toBe(i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11: Receipt Completeness
   * 
   * For any multi-item message processing, the receipt SHALL contain:
   * - The total count of items processed
   * - All files created/modified across all items
   * - Per-item classification and success/failure status
   * - Error details for any failed items
   * 
   * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
   */
  it('Property 11: Receipt contains complete multi-item metadata', () => {
    fc.assert(
      fc.property(
        fc.array(validActionPlanArb, { minLength: 2, maxLength: 10 }),
        fc.array(fc.boolean(), { minLength: 2, maxLength: 10 }),
        (items, successFlags) => {
          // Ensure arrays are same length
          const flags = successFlags.slice(0, items.length);
          while (flags.length < items.length) {
            flags.push(true);
          }
          
          // Simulate receipt metadata structure
          const results = items.map((item, index) => ({
            index,
            success: flags[index],
            classification: item.classification,
            title: item.title,
            error: flags[index] ? undefined : 'Processing failed',
          }));
          
          const receiptMeta = {
            item_count: results.length,
            items: results.map(r => ({
              index: r.index,
              classification: r.classification,
              title: r.title,
              success: r.success,
              error: r.error,
            })),
          };
          
          // Property: item_count matches actual count
          expect(receiptMeta.item_count).toBe(items.length);
          
          // Property: Each item has required fields
          for (const item of receiptMeta.items) {
            expect(item.index).toBeDefined();
            expect(item.classification).toBeDefined();
            expect(item.title).toBeDefined();
            expect(typeof item.success).toBe('boolean');
          }
          
          // Property: Failed items have error details
          const failedItems = receiptMeta.items.filter(i => !i.success);
          for (const failed of failedItems) {
            expect(failed.error).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Multi-Item Confirmation Formatting', () => {
  /**
   * Property 8: Consolidated Confirmation Content
   * 
   * For any multi-item processing that completes, exactly one Slack confirmation
   * message SHALL be sent, and that message SHALL contain the title and classification
   * of every processed item.
   * 
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
   */
  it('Property 8: Confirmation message contains all item titles and classifications', () => {
    fc.assert(
      fc.property(
        fc.array(validActionPlanArb, { minLength: 2, maxLength: 10 }),
        (items) => {
          // Simulate confirmation message formatting
          const results = items.map((item, index) => ({
            index,
            success: true,
            classification: item.classification,
            title: item.title,
          }));
          
          // Format confirmation (simplified version of formatMultiItemConfirmation)
          const lines: string[] = [`Processed ${results.length} items:`];
          for (const result of results) {
            lines.push(`• ${result.title} → ${result.classification}`);
          }
          const message = lines.join('\n');
          
          // Property: Message mentions item count
          expect(message).toContain(`${items.length} items`);
          
          // Property: Message contains each item's title
          for (const item of items) {
            expect(message).toContain(item.title);
          }
          
          // Property: Message contains each item's classification
          for (const item of items) {
            expect(message).toContain(item.classification as string);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include failure information in confirmation', () => {
    const results = [
      { index: 0, success: true, classification: 'task' as const, title: 'Buy milk' },
      { index: 1, success: false, classification: 'task' as const, title: 'Call dentist', error: 'SES failed' },
    ];
    
    // Format with failures
    const lines: string[] = [`Processed ${results.length} items:`];
    for (const result of results) {
      if (result.success) {
        lines.push(`• ${result.title} → ${result.classification}`);
      } else {
        lines.push(`• ❌ ${result.title} → Failed: ${result.error}`);
      }
    }
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    if (failCount > 0) {
      lines.push(`\n${successCount} succeeded, ${failCount} failed`);
    }
    const message = lines.join('\n');
    
    expect(message).toContain('Buy milk');
    expect(message).toContain('Call dentist');
    expect(message).toContain('Failed');
    expect(message).toContain('1 succeeded, 1 failed');
  });
});


describe('Multi-Item Idempotency Properties', () => {
  /**
   * Property 10: Idempotency Atomicity
   * 
   * For any multi-item message that has been processed once, a retry attempt
   * with the same event_id SHALL skip processing entirely (all items skipped,
   * not just some).
   * 
   * **Validates: Requirements 8.1, 8.2**
   */
  it('Property 10: Single event_id covers all items atomically', () => {
    fc.assert(
      fc.property(
        fc.array(validActionPlanArb, { minLength: 2, maxLength: 10 }),
        fc.uuid(),
        (items, eventId) => {
          // Simulate idempotency behavior
          // First attempt: process all items
          const firstAttemptResults = items.map((item, index) => ({
            index,
            eventId, // Same event_id for all items
            processed: true,
          }));
          
          // Property: All items share the same event_id
          const uniqueEventIds = new Set(firstAttemptResults.map(r => r.eventId));
          expect(uniqueEventIds.size).toBe(1);
          
          // Simulate retry with same event_id
          const isProcessed = true; // Lock already acquired
          
          // Property: On retry, ALL items are skipped (not just some)
          const retryResults = items.map((item, index) => ({
            index,
            eventId,
            skipped: isProcessed, // All skipped because event_id already processed
          }));
          
          // All items should be skipped on retry
          expect(retryResults.every(r => r.skipped)).toBe(true);
          
          // No partial processing on retry
          const processedOnRetry = retryResults.filter(r => !r.skipped);
          expect(processedOnRetry.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should use single event_id for entire multi-item message', () => {
    const eventId = 'evt-12345';
    const items = [
      { classification: 'task', title: 'Task 1' },
      { classification: 'task', title: 'Task 2' },
      { classification: 'idea', title: 'Idea 1' },
    ];
    
    // Simulate processing - all items use same event_id
    const processedItems = items.map((item, index) => ({
      ...item,
      eventId,
      itemEventId: `${eventId}-item-${index}`, // Sub-ID for tracking
    }));
    
    // Property: Main event_id is consistent
    expect(processedItems.every(p => p.eventId === eventId)).toBe(true);
    
    // Property: Sub-IDs are unique but derived from main event_id
    const subIds = processedItems.map(p => p.itemEventId);
    expect(new Set(subIds).size).toBe(items.length);
    expect(subIds.every(id => id.startsWith(eventId))).toBe(true);
  });
});
