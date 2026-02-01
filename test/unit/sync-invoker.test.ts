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
  invokeRepair,
  type SyncItemRequest,
  type DeleteItemRequest,
  type SyncAllRequest,
  type HealthCheckRequest,
  type RepairRequest,
  type SyncInvokerConfig,
} from '../../src/components/sync-invoker';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the SDK client
const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: vi.fn(function() {
    return {
      send: mockSend,
    };
  }),
  InvokeAgentRuntimeCommand: vi.fn(function(input) {
    return input;
  }),
}));

const testConfig: SyncInvokerConfig = {
  agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-runtime',
  region: 'us-east-1',
};

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock SDK response with transformToString method
 */
function createMockResponse(body: object): { response: { transformToString: () => Promise<string> } } {
  return {
    response: {
      transformToString: () => Promise.resolve(JSON.stringify(body)),
    },
  };
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
      itemContent: '---\nid: sb-abc1234\ntype: idea\ntitle: Test Idea\n---\n\n# Test Idea',
    };

    it('should invoke classifier with correct payload', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 1,
        items_deleted: 0,
      }));

      await invokeSyncItem(testConfig, syncItemRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should include commit_id when provided', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 1,
        items_deleted: 0,
      }));

      const requestWithCommit: SyncItemRequest = {
        ...syncItemRequest,
        commitId: 'abc123def',
      };

      await invokeSyncItem(testConfig, requestWithCommit);

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle sync failure gracefully', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: false,
        items_synced: 0,
        items_deleted: 0,
        error: 'Memory storage failed',
      }));

      // Should not throw - fire and forget semantics
      await expect(invokeSyncItem(testConfig, syncItemRequest)).resolves.toBeUndefined();
    });

    it('should handle network errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw - fire and forget semantics
      await expect(invokeSyncItem(testConfig, syncItemRequest)).resolves.toBeUndefined();
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

    it('should invoke classifier with correct payload', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 1,
      }));

      await invokeDeleteItem(testConfig, deleteItemRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle delete failure gracefully', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: false,
        items_synced: 0,
        items_deleted: 0,
        error: 'Item not found',
      }));

      // Should not throw - fire and forget semantics
      await expect(invokeDeleteItem(testConfig, deleteItemRequest)).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // invokeSyncAll Tests
  // ==========================================================================

  describe('invokeSyncAll', () => {
    const syncAllRequest: SyncAllRequest = {
      operation: 'sync_all',
      actorId: 'user-123',
    };

    it('should invoke classifier with correct payload', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 10,
        items_deleted: 0,
      }));

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(10);
    });

    it('should include force_full_sync when provided', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 15,
        items_deleted: 0,
      }));

      const requestWithForce: SyncAllRequest = {
        ...syncAllRequest,
        forceFullSync: true,
      };

      const result = await invokeSyncAll(testConfig, requestWithForce);

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(15);
    });

    it('should return error on failure', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: false,
        items_synced: 0,
        items_deleted: 0,
        error: 'CodeCommit access denied',
      }));

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('CodeCommit access denied');
    });

    it('should handle network errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Connection timeout'));

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timeout');
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

    it('should invoke classifier with correct payload', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 0,
        health_report: {
          codecommitCount: 10,
          memoryCount: 10,
          inSync: true,
          lastSyncTimestamp: '2026-01-20T10:00:00Z',
          lastSyncCommitId: 'abc123',
          missingInMemory: [],
          extraInMemory: [],
        },
      }));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.healthReport).toBeDefined();
    });

    it('should return health report with sync status', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 0,
        health_report: {
          codecommitCount: 10,
          memoryCount: 10,
          inSync: true,
          lastSyncTimestamp: '2026-01-20T10:00:00Z',
          lastSyncCommitId: 'abc123',
          missingInMemory: [],
          extraInMemory: [],
        },
      }));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.healthReport?.inSync).toBe(true);
      expect(result.healthReport?.missingInMemory).toHaveLength(0);
      expect(result.healthReport?.extraInMemory).toHaveLength(0);
    });

    it('should detect out-of-sync state', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 0,
        items_deleted: 0,
        health_report: {
          codecommitCount: 10,
          memoryCount: 8,
          inSync: false,
          lastSyncTimestamp: '2026-01-20T10:00:00Z',
          lastSyncCommitId: 'abc123',
          missingInMemory: ['sb-abc1234', 'sb-def5678'],
          extraInMemory: [],
        },
      }));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.healthReport?.inSync).toBe(false);
      expect(result.healthReport?.missingInMemory).toHaveLength(2);
    });
  });

  // ==========================================================================
  // invokeRepair Tests
  // ==========================================================================

  describe('invokeRepair', () => {
    const repairRequest: RepairRequest = {
      operation: 'repair',
      actorId: 'user-123',
      missingIds: ['sb-abc1234', 'sb-def5678'],
    };

    it('should invoke classifier with missing IDs', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 2,
        items_deleted: 0,
      }));

      const result = await invokeRepair(testConfig, repairRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(2);
    });

    it('should handle partial repair', async () => {
      mockSend.mockResolvedValueOnce(createMockResponse({
        success: true,
        items_synced: 1,
        items_deleted: 0,
        error: 'One item not found in CodeCommit',
      }));

      const result = await invokeRepair(testConfig, repairRequest);

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1);
      expect(result.error).toBe('One item not found in CodeCommit');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty response', async () => {
      mockSend.mockResolvedValueOnce({ response: null });

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'user-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty response from AgentCore');
    });

    it('should handle malformed JSON response', async () => {
      mockSend.mockResolvedValueOnce({
        response: {
          transformToString: () => Promise.resolve('not valid json'),
        },
      });

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'user-123',
      });

      expect(result.success).toBe(false);
    });

    it('should handle unknown error types', async () => {
      mockSend.mockRejectedValueOnce('string error');

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'user-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });
});