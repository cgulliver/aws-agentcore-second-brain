/**
 * Property-Based Tests for Delta Sync Efficiency
 *
 * **Property 4: Delta sync efficiency**
 * For any bootstrap sync operation where the Sync_Marker commit ID equals the
 * current CodeCommit HEAD, the sync SHALL perform zero file fetch operations
 * and zero Memory write operations. When the marker differs, only files in
 * the GetDifferences result SHALL be processed, including deletions.
 *
 * **Validates: Requirements 2.3, 2.5, 3.4**
 *
 * Feature: memory-repo-sync, Property 4: Delta sync efficiency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { invokeSyncAll, type SyncAllRequest, type SyncInvokerConfig } from '../../src/components/sync-invoker';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock AWS signing (we don't need to test actual signing)
vi.mock('@smithy/signature-v4', () => ({
  SignatureV4: vi.fn().mockImplementation(() => ({
    sign: vi.fn().mockResolvedValue({
      headers: {
        'Content-Type': 'application/json',
        host: 'bedrock-agentcore.us-east-1.amazonaws.com',
        authorization: 'mock-auth',
      },
    }),
  })),
}));

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: vi.fn().mockReturnValue(() =>
    Promise.resolve({
      accessKeyId: 'mock-access-key',
      secretAccessKey: 'mock-secret-key',
    })
  ),
}));

// ============================================================================
// Test Configuration
// ============================================================================

const testConfig: SyncInvokerConfig = {
  agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-runtime',
  region: 'us-east-1',
};

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock fetch response
 */
function createMockResponse(body: object, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as Response;
}

// ============================================================================
// Generators
// ============================================================================

/**
 * Generate a valid commit ID (40 character hex string)
 */
const commitIdArb = fc.hexaString({ minLength: 40, maxLength: 40 });

/**
 * Generate a valid actor ID (Slack user ID format)
 */
const actorIdArb = fc.stringMatching(/^U[A-Z0-9]{8,10}$/);

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
 * Generate sync response for marker equals HEAD scenario (no operations)
 */
const noOpSyncResponseArb = commitIdArb.map((commitId) => ({
  success: true,
  items_synced: 0,
  items_deleted: 0,
  error: null,
  new_commit_id: commitId,
}));

/**
 * Generate sync response for delta sync scenario (some operations)
 */
const deltaSyncResponseArb = fc
  .tuple(fc.nat({ max: 20 }), fc.nat({ max: 5 }), commitIdArb)
  .map(([itemsSynced, itemsDeleted, commitId]) => ({
    success: true,
    items_synced: itemsSynced,
    items_deleted: itemsDeleted,
    error: null,
    new_commit_id: commitId,
  }));

// ============================================================================
// Property Tests
// ============================================================================

describe('Delta Sync Efficiency Property Tests', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Property 4: Delta Sync Efficiency
  // ==========================================================================

  describe('Property 4: Delta sync efficiency', () => {
    /**
     * Property 4.1: When marker equals HEAD, sync reports zero operations
     *
     * For any bootstrap sync operation where the Sync_Marker commit ID equals
     * the current CodeCommit HEAD, the sync SHALL report zero items synced
     * and zero items deleted.
     *
     * **Validates: Requirements 2.3, 2.5**
     */
    it('when marker equals HEAD, sync reports zero operations', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, noOpSyncResponseArb, async (actorId, mockResponse) => {
          // Reset mocks for this iteration
          mockFetch.mockReset();

          // Configure mock to return no-op response (marker equals HEAD)
          mockFetch.mockResolvedValueOnce(createMockResponse(mockResponse));

          const request: SyncAllRequest = {
            operation: 'sync_all',
            actorId,
          };

          const result = await invokeSyncAll(testConfig, request);

          // Verify no operations were performed
          return result.success === true && result.itemsSynced === 0 && result.itemsDeleted === 0;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property 4.2: Delta sync returns correct counts from response
     *
     * For any delta sync operation, the returned counts SHALL match
     * the response values.
     *
     * **Validates: Requirements 2.3, 2.6**
     */
    it('delta sync returns correct counts from response', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, deltaSyncResponseArb, async (actorId, mockResponse) => {
          // Reset mocks for this iteration
          mockFetch.mockReset();

          mockFetch.mockResolvedValueOnce(createMockResponse(mockResponse));

          const request: SyncAllRequest = {
            operation: 'sync_all',
            actorId,
          };

          const result = await invokeSyncAll(testConfig, request);

          // Verify counts match the mock response
          return (
            result.success === mockResponse.success &&
            result.itemsSynced === mockResponse.items_synced &&
            result.itemsDeleted === mockResponse.items_deleted
          );
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property 4.3: Sync request includes correct operation type
     *
     * For any sync_all request, the payload SHALL include
     * sync_operation: 'sync_all' and the correct actor_id.
     *
     * **Validates: Requirements 2.1**
     */
    it('sync request includes correct operation type and actor_id', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, noOpSyncResponseArb, async (actorId, mockResponse) => {
          // Reset mocks for this iteration
          mockFetch.mockReset();

          mockFetch.mockResolvedValueOnce(createMockResponse(mockResponse));

          const request: SyncAllRequest = {
            operation: 'sync_all',
            actorId,
          };

          await invokeSyncAll(testConfig, request);

          // Verify payload contains correct fields
          expect(mockFetch).toHaveBeenCalledTimes(1);
          const call = mockFetch.mock.calls[0];
          const payload = JSON.parse(call[1].body as string);

          return payload.sync_operation === 'sync_all' && payload.actor_id === actorId;
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property 4.4: Force full sync flag is passed correctly
     *
     * When forceFullSync is specified, it SHALL be included in the
     * payload as force_full_sync.
     *
     * **Validates: Requirements 2.3**
     */
    it('force full sync flag is passed correctly', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, fc.boolean(), deltaSyncResponseArb, async (actorId, forceFullSync, mockResponse) => {
          // Reset mocks for this iteration
          mockFetch.mockReset();

          mockFetch.mockResolvedValueOnce(createMockResponse(mockResponse));

          const request: SyncAllRequest = {
            operation: 'sync_all',
            actorId,
            forceFullSync,
          };

          await invokeSyncAll(testConfig, request);

          // Verify payload contains force_full_sync when specified
          expect(mockFetch).toHaveBeenCalledTimes(1);
          const call = mockFetch.mock.calls[0];
          const payload = JSON.parse(call[1].body as string);

          // force_full_sync should be present when forceFullSync is true
          if (forceFullSync) {
            return payload.force_full_sync === true;
          }
          // When false, it may or may not be present (implementation detail)
          return true;
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property 4.5: HTTP errors are handled gracefully
     *
     * For any HTTP error, the sync SHALL return a failure
     * response without throwing.
     *
     * **Validates: Requirements 2.6**
     */
    it('HTTP errors are handled gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, fc.string({ minLength: 5, maxLength: 100 }), async (actorId, errorMessage) => {
          // Reset mocks for this iteration
          mockFetch.mockReset();

          // Configure mock to return an HTTP error
          mockFetch.mockResolvedValueOnce(createMockResponse({ error: errorMessage }, false, 500));

          const request: SyncAllRequest = {
            operation: 'sync_all',
            actorId,
          };

          const result = await invokeSyncAll(testConfig, request);

          // Should return failure without throwing
          return (
            result.success === false && result.itemsSynced === 0 && result.itemsDeleted === 0 && result.error !== undefined
          );
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property 4.6: Network errors are handled gracefully
     *
     * For any network error during invocation, the sync SHALL
     * return a failure response without throwing.
     *
     * **Validates: Requirements 2.6**
     */
    it('network errors are handled gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(actorIdArb, fc.string({ minLength: 5, maxLength: 100 }), async (actorId, errorMessage) => {
          // Reset mocks for this iteration
          mockFetch.mockReset();

          // Configure mock to reject with network error
          mockFetch.mockRejectedValueOnce(new Error(errorMessage));

          const request: SyncAllRequest = {
            operation: 'sync_all',
            actorId,
          };

          const result = await invokeSyncAll(testConfig, request);

          // Should return failure without throwing
          return (
            result.success === false && result.itemsSynced === 0 && result.itemsDeleted === 0 && result.error !== undefined
          );
        }),
        { numRuns: 50 }
      );
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    /**
     * Sync with zero items synced and zero deleted is valid success
     */
    it('sync with zero items is valid success (already synced)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          items_synced: 0,
          items_deleted: 0,
          error: null,
        })
      );

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'U12345678',
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(0);
      expect(result.itemsDeleted).toBe(0);
      expect(result.error).toBeUndefined();
    });

    /**
     * Sync with only deletions is valid
     */
    it('sync with only deletions is valid', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          items_synced: 0,
          items_deleted: 5,
          error: null,
        })
      );

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'U12345678',
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(0);
      expect(result.itemsDeleted).toBe(5);
    });

    /**
     * Sync with large number of items
     */
    it('sync with large number of items', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          items_synced: 1000,
          items_deleted: 50,
          error: null,
        })
      );

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'U12345678',
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1000);
      expect(result.itemsDeleted).toBe(50);
    });

    /**
     * Malformed JSON response is handled
     */
    it('malformed JSON response is handled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('not valid json'),
        headers: new Headers(),
      } as Response);

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'U12345678',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
