/**
 * Unit Tests for Sync Invoker
 *
 * Tests for AgentCore classifier invocation of sync operations.
 * Validates: Requirements 1.4, 3.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  invokeSyncItem,
  invokeDeleteItem,
  invokeSyncAll,
  invokeHealthCheck,
  type SyncItemRequest,
  type DeleteItemRequest,
  type SyncAllRequest,
  type HealthCheckRequest,
  type SyncInvokerConfig,
} from '../../src/components/sync-invoker';

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
  defaultProvider: vi.fn().mockReturnValue(() => Promise.resolve({
    accessKeyId: 'mock-access-key',
    secretAccessKey: 'mock-secret-key',
  })),
}));

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

/**
 * Extract the payload from the fetch call
 */
function extractPayload(callIndex = 0): object {
  const call = mockFetch.mock.calls[callIndex];
  if (!call || !call[1]?.body) return {};
  return JSON.parse(call[1].body as string);
}

// ============================================================================
// Tests
// ============================================================================

describe('Sync Invoker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // invokeSyncItem Tests
  // ==========================================================================

  describe('invokeSyncItem', () => {
    const syncItemRequest: SyncItemRequest = {
      operation: 'sync_item',
      actorId: 'user-123',
      itemPath: '10-ideas/2026-01-20__test-idea__sb-abc1234.md',
      itemContent: '---\ntitle: Test Idea\n---\nContent here',
    };

    it('should invoke AgentCore with sync_operation payload', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 1,
        items_deleted: 0,
      }));

      await invokeSyncItem(testConfig, syncItemRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const payload = extractPayload();
      expect(payload).toEqual({
        sync_operation: 'sync_item',
        actor_id: 'user-123',
        item_path: '10-ideas/2026-01-20__test-idea__sb-abc1234.md',
        item_content: '---\ntitle: Test Idea\n---\nContent here',
      });
    });

    it('should not throw on AgentCore error (fire-and-forget)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(invokeSyncItem(testConfig, syncItemRequest)).resolves.toBeUndefined();
    });

    it('should log error on AgentCore failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await invokeSyncItem(testConfig, syncItemRequest);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to invoke sync operation',
        expect.objectContaining({
          error: 'Network error',
          operation: 'sync_item',
        })
      );
      consoleSpy.mockRestore();
    });
  });

  // ==========================================================================
  // invokeDeleteItem Tests
  // ==========================================================================

  describe('invokeDeleteItem', () => {
    const deleteItemRequest: DeleteItemRequest = {
      operation: 'delete_item',
      actorId: 'user-123',
      sbId: 'sb-abc1234',
    };

    it('should invoke AgentCore with delete_item payload', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 1,
      }));

      await invokeDeleteItem(testConfig, deleteItemRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const payload = extractPayload();
      expect(payload).toEqual({
        sync_operation: 'delete_item',
        actor_id: 'user-123',
        sb_id: 'sb-abc1234',
      });
    });

    it('should not throw on AgentCore error (fire-and-forget)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(invokeDeleteItem(testConfig, deleteItemRequest)).resolves.toBeUndefined();
    });

    it('should log error on AgentCore failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await invokeDeleteItem(testConfig, deleteItemRequest);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to invoke sync operation',
        expect.objectContaining({
          error: 'Network error',
          operation: 'delete_item',
        })
      );
      consoleSpy.mockRestore();
    });
  });

  // ==========================================================================
  // invokeSyncAll Tests
  // ==========================================================================

  describe('invokeSyncAll', () => {
    const syncAllRequest: SyncAllRequest = {
      operation: 'sync_all',
      actorId: 'user-123',
      forceFullSync: true,
    };

    it('should invoke AgentCore with sync_all payload', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 5,
        items_deleted: 0,
      }));

      await invokeSyncAll(testConfig, syncAllRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const payload = extractPayload();
      expect(payload).toEqual({
        sync_operation: 'sync_all',
        actor_id: 'user-123',
        force_full_sync: true,
      });
    });

    it('should return sync response with correct fields', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 5,
        items_deleted: 2,
      }));

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(result).toEqual({
        success: true,
        itemsSynced: 5,
        itemsDeleted: 2,
      });
    });

    it('should handle forceFullSync being undefined', async () => {
      const requestWithoutForce: SyncAllRequest = {
        operation: 'sync_all',
        actorId: 'user-123',
      };

      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 3,
        items_deleted: 0,
      }));

      await invokeSyncAll(testConfig, requestWithoutForce);

      const payload = extractPayload();
      // force_full_sync should not be present when undefined
      expect(payload).toEqual({
        sync_operation: 'sync_all',
        actor_id: 'user-123',
      });
    });

    it('should return error response on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: 'Internal error' },
        false,
        500
      ));

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('AgentCore error');
    });

    it('should return error response on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.itemsSynced).toBe(0);
      expect(result.itemsDeleted).toBe(0);
    });

    it('should include error from response', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: false,
        items_synced: 0,
        items_deleted: 0,
        error: 'CodeCommit unavailable',
      }));

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('CodeCommit unavailable');
    });
  });

  // ==========================================================================
  // invokeHealthCheck Tests
  // ==========================================================================

  describe('invokeHealthCheck', () => {
    const healthCheckRequest: HealthCheckRequest = {
      operation: 'health_check',
      actorId: 'user-123',
    };

    it('should invoke AgentCore with health_check payload', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 0,
        health_report: {
          codecommitCount: 10,
          memoryCount: 10,
          inSync: true,
          lastSyncTimestamp: '2026-01-20T15:30:00Z',
          lastSyncCommitId: 'abc1234',
          missingInMemory: [],
          extraInMemory: [],
        },
      }));

      await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const payload = extractPayload();
      expect(payload).toEqual({
        sync_operation: 'health_check',
        actor_id: 'user-123',
      });
    });

    it('should return health report with correct fields', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 0,
        health_report: {
          codecommitCount: 10,
          memoryCount: 8,
          inSync: false,
          lastSyncTimestamp: '2026-01-20T15:30:00Z',
          lastSyncCommitId: 'abc1234',
          missingInMemory: ['sb-1234567', 'sb-2345678'],
          extraInMemory: ['sb-3456789'],
        },
      }));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.success).toBe(true);
      expect(result.healthReport).toEqual({
        codecommitCount: 10,
        memoryCount: 8,
        inSync: false,
        lastSyncTimestamp: '2026-01-20T15:30:00Z',
        lastSyncCommitId: 'abc1234',
        missingInMemory: ['sb-1234567', 'sb-2345678'],
        extraInMemory: ['sb-3456789'],
      });
    });

    it('should handle null timestamps in health report', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 0,
        health_report: {
          codecommitCount: 5,
          memoryCount: 0,
          inSync: false,
          lastSyncTimestamp: null,
          lastSyncCommitId: null,
          missingInMemory: ['sb-1', 'sb-2', 'sb-3', 'sb-4', 'sb-5'],
          extraInMemory: [],
        },
      }));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.healthReport?.lastSyncTimestamp).toBeNull();
      expect(result.healthReport?.lastSyncCommitId).toBeNull();
    });

    it('should return error response on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: 'Internal error' },
        false,
        500
      ));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('AgentCore error');
    });

    it('should return error response on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');
    });

    it('should handle in-sync state correctly', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 0,
        health_report: {
          codecommitCount: 10,
          memoryCount: 10,
          inSync: true,
          lastSyncTimestamp: '2026-01-20T15:30:00Z',
          lastSyncCommitId: 'abc1234',
          missingInMemory: [],
          extraInMemory: [],
        },
      }));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.healthReport?.inSync).toBe(true);
      expect(result.healthReport?.missingInMemory).toHaveLength(0);
      expect(result.healthReport?.extraInMemory).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('not valid json'),
        headers: new Headers(),
      } as Response);

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'user-123',
      });

      expect(result.success).toBe(false);
    });

    it('should handle unknown error types', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'user-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });
});
