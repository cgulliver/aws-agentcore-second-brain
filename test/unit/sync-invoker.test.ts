/**
 * Unit Tests for Sync Invoker
 *
 * Tests for Lambda invocation of sync operations.
 * Validates: Requirements 1.4, 3.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  invokeSyncItem,
  invokeDeleteItem,
  invokeSyncAll,
  invokeHealthCheck,
  clearLambdaClient,
  setLambdaClient,
  type SyncItemRequest,
  type DeleteItemRequest,
  type SyncAllRequest,
  type HealthCheckRequest,
  type SyncInvokerConfig,
} from '../../src/components/sync-invoker';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock Lambda client
const mockSend = vi.fn();
const mockLambdaClient = {
  send: mockSend,
} as unknown as LambdaClient;

const testConfig: SyncInvokerConfig = {
  syncLambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:SyncLambda',
  region: 'us-east-1',
};

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock Lambda response payload
 */
function createMockPayload(response: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(response));
}

/**
 * Extract the payload from the InvokeCommand
 */
function extractPayload(command: InvokeCommand): object {
  const payloadBytes = command.input.Payload;
  if (!payloadBytes) return {};
  const payloadText = new TextDecoder().decode(payloadBytes as Uint8Array);
  return JSON.parse(payloadText);
}

// ============================================================================
// Tests
// ============================================================================

describe('Sync Invoker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLambdaClient();
    setLambdaClient(mockLambdaClient);
  });

  afterEach(() => {
    clearLambdaClient();
  });

  // ==========================================================================
  // invokeSyncItem Tests
  // ==========================================================================

  describe('invokeSyncItem', () => {
    const syncItemRequest: SyncItemRequest = {
      operation: 'sync_item',
      actorId: 'user-123',
      itemPath: '10-ideas/2026-01-20__test-idea__sb-abc123.md',
      itemContent: '---\ntitle: Test Idea\n---\nContent here',
    };

    it('should invoke Lambda with async invocation type (Event)', async () => {
      mockSend.mockResolvedValueOnce({});

      await invokeSyncItem(testConfig, syncItemRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      expect(command.input.InvocationType).toBe(InvocationType.Event);
    });

    it('should convert camelCase to snake_case in payload', async () => {
      mockSend.mockResolvedValueOnce({});

      await invokeSyncItem(testConfig, syncItemRequest);

      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      const payload = extractPayload(command);

      expect(payload).toEqual({
        operation: 'sync_item',
        actor_id: 'user-123',
        item_path: '10-ideas/2026-01-20__test-idea__sb-abc123.md',
        item_content: '---\ntitle: Test Idea\n---\nContent here',
      });
    });

    it('should use correct Lambda ARN', async () => {
      mockSend.mockResolvedValueOnce({});

      await invokeSyncItem(testConfig, syncItemRequest);

      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      expect(command.input.FunctionName).toBe(testConfig.syncLambdaArn);
    });

    it('should not throw on Lambda error (fire-and-forget)', async () => {
      mockSend.mockRejectedValueOnce(new Error('Lambda invocation failed'));

      // Should not throw
      await expect(invokeSyncItem(testConfig, syncItemRequest)).resolves.toBeUndefined();
    });

    it('should log error on Lambda failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSend.mockRejectedValueOnce(new Error('Lambda invocation failed'));

      await invokeSyncItem(testConfig, syncItemRequest);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to invoke sync item',
        expect.objectContaining({
          error: 'Lambda invocation failed',
          itemPath: syncItemRequest.itemPath,
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
      sbId: 'sb-abc123',
    };

    it('should invoke Lambda with async invocation type (Event)', async () => {
      mockSend.mockResolvedValueOnce({});

      await invokeDeleteItem(testConfig, deleteItemRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      expect(command.input.InvocationType).toBe(InvocationType.Event);
    });

    it('should convert camelCase to snake_case in payload', async () => {
      mockSend.mockResolvedValueOnce({});

      await invokeDeleteItem(testConfig, deleteItemRequest);

      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      const payload = extractPayload(command);

      expect(payload).toEqual({
        operation: 'delete_item',
        actor_id: 'user-123',
        sb_id: 'sb-abc123',
      });
    });

    it('should not throw on Lambda error (fire-and-forget)', async () => {
      mockSend.mockRejectedValueOnce(new Error('Lambda invocation failed'));

      // Should not throw
      await expect(invokeDeleteItem(testConfig, deleteItemRequest)).resolves.toBeUndefined();
    });

    it('should log error on Lambda failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSend.mockRejectedValueOnce(new Error('Lambda invocation failed'));

      await invokeDeleteItem(testConfig, deleteItemRequest);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to invoke delete item',
        expect.objectContaining({
          error: 'Lambda invocation failed',
          sbId: deleteItemRequest.sbId,
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

    it('should invoke Lambda with sync invocation type (RequestResponse)', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 5,
          items_deleted: 0,
        }),
      });

      await invokeSyncAll(testConfig, syncAllRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      expect(command.input.InvocationType).toBe(InvocationType.RequestResponse);
    });

    it('should convert camelCase to snake_case in payload', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 5,
          items_deleted: 0,
        }),
      });

      await invokeSyncAll(testConfig, syncAllRequest);

      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      const payload = extractPayload(command);

      expect(payload).toEqual({
        operation: 'sync_all',
        actor_id: 'user-123',
        force_full_sync: true,
      });
    });

    it('should convert snake_case response to camelCase', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 5,
          items_deleted: 2,
        }),
      });

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

      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 3,
          items_deleted: 0,
        }),
      });

      await invokeSyncAll(testConfig, requestWithoutForce);

      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      const payload = extractPayload(command);

      // force_full_sync should not be present when undefined
      expect(payload).toEqual({
        operation: 'sync_all',
        actor_id: 'user-123',
      });
    });

    it('should return error response on Lambda function error', async () => {
      mockSend.mockResolvedValueOnce({
        FunctionError: 'Unhandled',
        Payload: createMockPayload({ errorMessage: 'Something went wrong' }),
      });

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync Lambda execution failed');
    });

    it('should return error response on Lambda invocation failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      const result = await invokeSyncAll(testConfig, syncAllRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.itemsSynced).toBe(0);
      expect(result.itemsDeleted).toBe(0);
    });

    it('should include error from Lambda response', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: false,
          items_synced: 0,
          items_deleted: 0,
          error: 'CodeCommit unavailable',
        }),
      });

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

    it('should invoke Lambda with sync invocation type (RequestResponse)', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 0,
          items_deleted: 0,
          health_report: {
            codecommit_count: 10,
            memory_count: 10,
            in_sync: true,
            last_sync_timestamp: '2026-01-20T15:30:00Z',
            last_sync_commit_id: 'abc1234',
            missing_in_memory: [],
            extra_in_memory: [],
          },
        }),
      });

      await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      expect(command.input.InvocationType).toBe(InvocationType.RequestResponse);
    });

    it('should convert camelCase to snake_case in payload', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 0,
          items_deleted: 0,
          health_report: {
            codecommit_count: 10,
            memory_count: 10,
            in_sync: true,
            last_sync_timestamp: null,
            last_sync_commit_id: null,
            missing_in_memory: [],
            extra_in_memory: [],
          },
        }),
      });

      await invokeHealthCheck(testConfig, healthCheckRequest);

      const command = mockSend.mock.calls[0][0] as InvokeCommand;
      const payload = extractPayload(command);

      expect(payload).toEqual({
        operation: 'health_check',
        actor_id: 'user-123',
      });
    });

    it('should convert snake_case health report to camelCase', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 0,
          items_deleted: 0,
          health_report: {
            codecommit_count: 10,
            memory_count: 8,
            in_sync: false,
            last_sync_timestamp: '2026-01-20T15:30:00Z',
            last_sync_commit_id: 'abc1234',
            missing_in_memory: ['sb-123', 'sb-456'],
            extra_in_memory: ['sb-789'],
          },
        }),
      });

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.success).toBe(true);
      expect(result.healthReport).toEqual({
        codecommitCount: 10,
        memoryCount: 8,
        inSync: false,
        lastSyncTimestamp: '2026-01-20T15:30:00Z',
        lastSyncCommitId: 'abc1234',
        missingInMemory: ['sb-123', 'sb-456'],
        extraInMemory: ['sb-789'],
      });
    });

    it('should handle null timestamps in health report', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 0,
          items_deleted: 0,
          health_report: {
            codecommit_count: 5,
            memory_count: 0,
            in_sync: false,
            last_sync_timestamp: null,
            last_sync_commit_id: null,
            missing_in_memory: ['sb-1', 'sb-2', 'sb-3', 'sb-4', 'sb-5'],
            extra_in_memory: [],
          },
        }),
      });

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.healthReport?.lastSyncTimestamp).toBeNull();
      expect(result.healthReport?.lastSyncCommitId).toBeNull();
    });

    it('should return error response on Lambda function error', async () => {
      mockSend.mockResolvedValueOnce({
        FunctionError: 'Unhandled',
        Payload: createMockPayload({ errorMessage: 'Something went wrong' }),
      });

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Health check Lambda execution failed');
    });

    it('should return error response on Lambda invocation failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Timeout'));

      const result = await invokeHealthCheck(testConfig, healthCheckRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');
    });

    it('should handle in-sync state correctly', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: createMockPayload({
          success: true,
          items_synced: 0,
          items_deleted: 0,
          health_report: {
            codecommit_count: 10,
            memory_count: 10,
            in_sync: true,
            last_sync_timestamp: '2026-01-20T15:30:00Z',
            last_sync_commit_id: 'abc1234',
            missing_in_memory: [],
            extra_in_memory: [],
          },
        }),
      });

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
    it('should handle empty payload response', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: undefined,
      });

      const result = await invokeSyncAll(testConfig, {
        operation: 'sync_all',
        actorId: 'user-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Empty response');
    });

    it('should handle malformed JSON response', async () => {
      mockSend.mockResolvedValueOnce({
        Payload: new TextEncoder().encode('not valid json'),
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
