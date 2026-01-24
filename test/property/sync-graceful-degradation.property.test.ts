/**
 * Property-Based Tests for Sync Graceful Degradation
 *
 * **Property 3: Graceful degradation on sync failure**
 * For any sync operation (create, update, or delete) that fails due to Memory
 * unavailability or API errors, the main operation (commit, reclassification,
 * classification) SHALL complete successfully, and the error SHALL be logged
 * without exposing internal details to the user.
 *
 * **Validates: Requirements 1.4, 3.3, 4.3**
 *
 * Feature: memory-repo-sync, Property 3: Graceful degradation on sync failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  invokeSyncItem,
  invokeDeleteItem,
  clearLambdaClient,
  setLambdaClient,
  type SyncItemRequest,
  type DeleteItemRequest,
  type SyncInvokerConfig,
} from '../../src/components/sync-invoker';
import { LambdaClient } from '@aws-sdk/client-lambda';

// ============================================================================
// Test Configuration
// ============================================================================

const testConfig: SyncInvokerConfig = {
  syncLambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:SyncLambda',
  region: 'us-east-1',
};

// ============================================================================
// Generators
// ============================================================================

/**
 * Generate a valid SB_ID
 */
const sbIdArb = fc.hexaString({ minLength: 7, maxLength: 7 }).map((hex) => `sb-${hex}`);

/**
 * Generate a valid file path for syncable items
 */
const filePathArb = fc
  .tuple(
    fc.constantFrom('10-ideas', '20-decisions', '30-projects'),
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
    fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
    sbIdArb
  )
  .map(([folder, date, slug, sbId]) => {
    const dateStr = date.toISOString().slice(0, 10);
    return `${folder}/${dateStr}__${slug}__${sbId}.md`;
  });

/**
 * Generate valid file content with front matter
 */
const fileContentArb = fc
  .tuple(
    sbIdArb,
    fc.constantFrom('idea', 'decision', 'project'),
    fc.string({ minLength: 5, maxLength: 50 }).filter((s) => !s.includes('"') && !s.includes('\n')),
    fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/), { minLength: 0, maxLength: 3 })
  )
  .map(([sbId, type, title, tags]) => {
    const tagsYaml = tags.length > 0 ? tags.map((t) => `  - ${t}`).join('\n') : '[]';
    return `---
id: ${sbId}
type: ${type}
title: "${title}"
created_at: ${new Date().toISOString()}
tags:${tags.length > 0 ? '\n' + tagsYaml : ' ' + tagsYaml}
---

# ${title}

Content here.
`;
  });

/**
 * Generate a valid actor ID (Slack user ID format)
 */
const actorIdArb = fc.stringMatching(/^U[A-Z0-9]{8,10}$/);

/**
 * Generate various error types that could occur during sync
 */
const errorTypeArb = fc.constantFrom(
  'NetworkError',
  'TimeoutError',
  'ServiceUnavailable',
  'ThrottlingException',
  'InternalServerError',
  'AccessDeniedException',
  'ResourceNotFoundException',
  'ValidationException'
);

/**
 * Generate error messages
 */
const errorMessageArb = fc
  .tuple(errorTypeArb, fc.string({ minLength: 10, maxLength: 100 }))
  .map(([type, detail]) => `${type}: ${detail}`);

// ============================================================================
// Property Tests
// ============================================================================

describe('Sync Graceful Degradation Property Tests', () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let mockLambdaClient: LambdaClient;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSend = vi.fn();
    mockLambdaClient = { send: mockSend } as unknown as LambdaClient;
    clearLambdaClient();
    setLambdaClient(mockLambdaClient);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    clearLambdaClient();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Property 3: Graceful Degradation on Sync Failure
  // ==========================================================================

  describe('Property 3: Graceful degradation on sync failure', () => {
    /**
     * Property 3.1: invokeSyncItem never throws on Lambda failure
     *
     * For any sync_item operation that fails, the function SHALL NOT throw
     * an exception, allowing the main operation to continue.
     */
    it('invokeSyncItem never throws regardless of error type', async () => {
      await fc.assert(
        fc.asyncProperty(
          actorIdArb,
          filePathArb,
          fileContentArb,
          errorMessageArb,
          async (actorId, itemPath, itemContent, errorMessage) => {
            // Reset mocks for this iteration
            mockSend.mockReset();

            // Configure mock to reject with the error
            mockSend.mockRejectedValueOnce(new Error(errorMessage));

            const request: SyncItemRequest = {
              operation: 'sync_item',
              actorId,
              itemPath,
              itemContent,
            };

            // Should NOT throw - fire and forget
            const result = await invokeSyncItem(testConfig, request);
            return result === undefined;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 3.2: invokeDeleteItem never throws on Lambda failure
     *
     * For any delete_item operation that fails, the function SHALL NOT throw
     * an exception, allowing the main operation to continue.
     */
    it('invokeDeleteItem never throws regardless of error type', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, sbIdArb, errorMessageArb, async (actorId, sbId, errorMessage) => {
          // Reset mocks for this iteration
          mockSend.mockReset();

          // Configure mock to reject with the error
          mockSend.mockRejectedValueOnce(new Error(errorMessage));

          const request: DeleteItemRequest = {
            operation: 'delete_item',
            actorId,
            sbId,
          };

          // Should NOT throw - fire and forget
          const result = await invokeDeleteItem(testConfig, request);
          return result === undefined;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property 3.3: Errors are logged on sync failure
     *
     * For any sync failure, the error SHALL be logged.
     */
    it('errors are logged on sync failure', async () => {
      await fc.assert(
        fc.asyncProperty(
          actorIdArb,
          filePathArb,
          fileContentArb,
          errorMessageArb,
          async (actorId, itemPath, itemContent, errorMessage) => {
            // Reset mocks for this iteration
            mockSend.mockReset();
            consoleErrorSpy.mockClear();

            mockSend.mockRejectedValueOnce(new Error(errorMessage));

            const request: SyncItemRequest = {
              operation: 'sync_item',
              actorId,
              itemPath,
              itemContent,
            };

            await invokeSyncItem(testConfig, request);

            // Error should be logged
            return consoleErrorSpy.mock.calls.length > 0;
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property 3.4: Delete errors are logged
     *
     * For any delete failure, the error SHALL be logged.
     */
    it('delete errors are logged', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, sbIdArb, errorMessageArb, async (actorId, sbId, errorMessage) => {
          // Reset mocks for this iteration
          mockSend.mockReset();
          consoleErrorSpy.mockClear();

          mockSend.mockRejectedValueOnce(new Error(errorMessage));

          const request: DeleteItemRequest = {
            operation: 'delete_item',
            actorId,
            sbId,
          };

          await invokeDeleteItem(testConfig, request);

          // Error should be logged
          return consoleErrorSpy.mock.calls.length > 0;
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property 3.5: Successful sync operations complete without error
     *
     * For any successful sync operation, the function SHALL complete
     * without throwing.
     */
    it('successful sync operations complete without error', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, filePathArb, fileContentArb, async (actorId, itemPath, itemContent) => {
          // Reset mocks for this iteration
          mockSend.mockReset();

          // Configure mock to succeed
          mockSend.mockResolvedValueOnce({});

          const request: SyncItemRequest = {
            operation: 'sync_item',
            actorId,
            itemPath,
            itemContent,
          };

          const result = await invokeSyncItem(testConfig, request);
          return result === undefined;
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property 3.6: Successful delete operations complete without error
     *
     * For any successful delete operation, the function SHALL complete
     * without throwing.
     */
    it('successful delete operations complete without error', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, sbIdArb, async (actorId, sbId) => {
          // Reset mocks for this iteration
          mockSend.mockReset();

          // Configure mock to succeed
          mockSend.mockResolvedValueOnce({});

          const request: DeleteItemRequest = {
            operation: 'delete_item',
            actorId,
            sbId,
          };

          const result = await invokeDeleteItem(testConfig, request);
          return result === undefined;
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property 3.7: Multiple consecutive failures don't accumulate
     *
     * For any sequence of sync failures, each failure SHALL be handled
     * independently without affecting subsequent operations.
     */
    it('multiple consecutive failures are handled independently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(actorIdArb, filePathArb, fileContentArb, errorMessageArb), {
            minLength: 2,
            maxLength: 5,
          }),
          async (operations) => {
            // Reset mocks for this iteration
            mockSend.mockReset();
            consoleErrorSpy.mockClear();

            // Configure mock to fail for all operations
            for (const [, , , errorMessage] of operations) {
              mockSend.mockRejectedValueOnce(new Error(errorMessage));
            }

            // All operations should complete without throwing
            for (const [actorId, itemPath, itemContent] of operations) {
              const request: SyncItemRequest = {
                operation: 'sync_item',
                actorId,
                itemPath,
                itemContent,
              };

              const result = await invokeSyncItem(testConfig, request);
              if (result !== undefined) return false;
            }

            // Each failure should be logged independently
            return consoleErrorSpy.mock.calls.length === operations.length;
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * Property 3.8: Mixed success and failure operations work correctly
     *
     * For any sequence of sync operations with mixed success/failure,
     * each operation SHALL be handled independently.
     */
    it('mixed success and failure operations work correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.tuple(
              actorIdArb,
              filePathArb,
              fileContentArb,
              fc.boolean() // true = success, false = failure
            ),
            { minLength: 3, maxLength: 6 }
          ),
          async (operations) => {
            // Reset mocks for this iteration
            mockSend.mockReset();
            consoleErrorSpy.mockClear();
            consoleLogSpy.mockClear();

            // Configure mock based on success/failure flag
            for (const [, , , shouldSucceed] of operations) {
              if (shouldSucceed) {
                mockSend.mockResolvedValueOnce({});
              } else {
                mockSend.mockRejectedValueOnce(new Error('Test error'));
              }
            }

            // All operations should complete without throwing
            for (const [actorId, itemPath, itemContent] of operations) {
              const request: SyncItemRequest = {
                operation: 'sync_item',
                actorId,
                itemPath,
                itemContent,
              };

              const result = await invokeSyncItem(testConfig, request);
              if (result !== undefined) return false;
            }

            // Count expected successes and failures
            const expectedSuccesses = operations.filter(([, , , s]) => s).length;
            const expectedFailures = operations.filter(([, , , s]) => !s).length;

            return (
              consoleLogSpy.mock.calls.length === expectedSuccesses &&
              consoleErrorSpy.mock.calls.length === expectedFailures
            );
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    /**
     * Empty or null error messages are handled gracefully
     */
    it('handles empty error messages gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error(''));

      const request: SyncItemRequest = {
        operation: 'sync_item',
        actorId: 'U12345678',
        itemPath: '10-ideas/2025-01-20__test__sb-abc1234.md',
        itemContent: '---\nid: sb-abc1234\n---\nContent',
      };

      await expect(invokeSyncItem(testConfig, request)).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    /**
     * Non-Error objects thrown are handled gracefully
     */
    it('handles non-Error objects thrown gracefully', async () => {
      mockSend.mockRejectedValueOnce('string error');

      const request: SyncItemRequest = {
        operation: 'sync_item',
        actorId: 'U12345678',
        itemPath: '10-ideas/2025-01-20__test__sb-abc1234.md',
        itemContent: '---\nid: sb-abc1234\n---\nContent',
      };

      await expect(invokeSyncItem(testConfig, request)).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][1]).toHaveProperty('error', 'Unknown error');
    });

    /**
     * Undefined rejection is handled gracefully
     */
    it('handles undefined rejection gracefully', async () => {
      mockSend.mockRejectedValueOnce(undefined);

      const request: DeleteItemRequest = {
        operation: 'delete_item',
        actorId: 'U12345678',
        sbId: 'sb-abc1234',
      };

      await expect(invokeDeleteItem(testConfig, request)).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
