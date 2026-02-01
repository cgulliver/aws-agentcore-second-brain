/**
 * Sync Invoker
 *
 * Invokes sync operations via the AgentCore classifier.
 * The classifier handles sync operations when payload contains sync_operation field.
 *
 * Uses @aws-sdk/client-bedrock-agentcore for API calls.
 *
 * Validates: Requirements 1.1, 2.1, 3.1, 5.1
 */

import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';

// ============================================================================
// Interfaces
// ============================================================================

export interface SyncItemRequest {
  operation: 'sync_item';
  actorId: string;
  itemPath: string;
  itemContent: string;
  commitId?: string;  // Optional: update sync marker after successful sync
}

export interface DeleteItemRequest {
  operation: 'delete_item';
  actorId: string;
  sbId: string;
}

export interface SyncAllRequest {
  operation: 'sync_all';
  actorId: string;
  forceFullSync?: boolean;
}

export interface HealthCheckRequest {
  operation: 'health_check';
  actorId: string;
}

export interface RepairRequest {
  operation: 'repair';
  actorId: string;
  missingIds: string[];  // sb_ids to sync
}

export interface SyncResponse {
  success: boolean;
  itemsSynced: number;
  itemsDeleted: number;
  error?: string;
  healthReport?: HealthReport;
}

export interface HealthReport {
  codecommitCount: number;
  memoryCount: number;
  inSync: boolean;
  lastSyncTimestamp: string | null;
  lastSyncCommitId: string | null;
  missingInMemory: string[];
  extraInMemory: string[];
}

export interface SyncInvokerConfig {
  /** AgentCore Runtime ARN (classifier handles sync operations) */
  agentRuntimeArn: string;
  region: string;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Classifier payload format for sync operations
 */
interface SyncPayload {
  sync_operation: string;
  actor_id: string;
  item_path?: string;
  item_content?: string;
  commit_id?: string;
  sb_id?: string;
  missing_ids?: string[];
  force_full_sync?: boolean;
}

/**
 * Classifier response format for sync operations
 */
interface ClassifierSyncResponse {
  success: boolean;
  items_synced: number;
  items_deleted: number;
  error?: string | null;
  health_report?: {
    codecommitCount: number;
    memoryCount: number;
    inSync: boolean;
    lastSyncTimestamp: string | null;
    lastSyncCommitId: string | null;
    missingInMemory: string[];
    extraInMemory: string[];
  } | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert request to classifier payload format
 */
function toSyncPayload(
  request: SyncItemRequest | DeleteItemRequest | SyncAllRequest | HealthCheckRequest
): SyncPayload {
  const payload: SyncPayload = {
    sync_operation: request.operation,
    actor_id: request.actorId,
  };

  if ('itemPath' in request) {
    payload.item_path = request.itemPath;
  }
  if ('itemContent' in request) {
    payload.item_content = request.itemContent;
  }
  if ('commitId' in request && request.commitId) {
    payload.commit_id = request.commitId;
  }
  if ('sbId' in request) {
    payload.sb_id = request.sbId;
  }
  if ('forceFullSync' in request && request.forceFullSync !== undefined) {
    payload.force_full_sync = request.forceFullSync;
  }

  return payload;
}

/**
 * Convert classifier response to SyncResponse
 */
function toSyncResponse(response: ClassifierSyncResponse): SyncResponse {
  const result: SyncResponse = {
    success: response.success,
    itemsSynced: response.items_synced,
    itemsDeleted: response.items_deleted,
  };

  if (response.error) {
    result.error = response.error;
  }

  if (response.health_report) {
    result.healthReport = response.health_report;
  }

  return result;
}

/**
 * Convert SDK streaming response to string
 * The SDK returns a SdkStreamMixin which has a transformToString method
 */
async function streamToString(stream: unknown): Promise<string> {
  // SDK stream has transformToString method
  if (stream && typeof stream === 'object' && 'transformToString' in stream) {
    const sdkStream = stream as { transformToString: () => Promise<string> };
    return await sdkStream.transformToString();
  }

  // If it's already a Uint8Array, decode directly
  if (stream instanceof Uint8Array) {
    return new TextDecoder().decode(stream);
  }

  // If it's a string, return as-is
  if (typeof stream === 'string') {
    return stream;
  }

  // Fallback: try to convert to string
  return String(stream);
}

/**
 * Invoke AgentCore classifier with sync operation payload
 */
async function invokeClassifierSync(
  config: SyncInvokerConfig,
  payload: SyncPayload
): Promise<SyncResponse> {
  const client = new BedrockAgentCoreClient({ region: config.region });

  try {
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: config.agentRuntimeArn,
      payload: Buffer.from(JSON.stringify(payload)),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await client.send(command);

    if (!response.response) {
      return {
        success: false,
        itemsSynced: 0,
        itemsDeleted: 0,
        error: 'Empty response from AgentCore',
      };
    }

    const responseText = await streamToString(response.response);
    const parsedResponse = JSON.parse(responseText) as ClassifierSyncResponse;

    return toSyncResponse(parsedResponse);
  } catch (error) {
    console.error('Failed to invoke sync operation', {
      error: error instanceof Error ? error.message : 'Unknown error',
      operation: payload.sync_operation,
    });
    return {
      success: false,
      itemsSynced: 0,
      itemsDeleted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Invoke classifier to sync a single item after commit.
 * Note: AgentCore doesn't support async invocation, so this waits for response
 * but doesn't block the caller (errors are logged but not thrown).
 *
 * Validates: Requirements 1.1, 1.3
 */
export async function invokeSyncItem(
  config: SyncInvokerConfig,
  request: SyncItemRequest
): Promise<void> {
  const payload = toSyncPayload(request);

  try {
    const result = await invokeClassifierSync(config, payload);
    console.log('Sync item completed', {
      operation: request.operation,
      itemPath: request.itemPath,
      success: result.success,
    });
  } catch (error) {
    // Log error but don't throw - fire and forget semantics
    console.error('Failed to sync item', {
      error: error instanceof Error ? error.message : 'Unknown error',
      itemPath: request.itemPath,
    });
  }
}

/**
 * Invoke classifier to delete an item.
 * Note: AgentCore doesn't support async invocation, so this waits for response
 * but doesn't block the caller (errors are logged but not thrown).
 *
 * Validates: Requirements 3.1, 3.2
 */
export async function invokeDeleteItem(
  config: SyncInvokerConfig,
  request: DeleteItemRequest
): Promise<void> {
  const payload = toSyncPayload(request);

  try {
    const result = await invokeClassifierSync(config, payload);
    console.log('Delete item completed', {
      operation: request.operation,
      sbId: request.sbId,
      success: result.success,
    });
  } catch (error) {
    // Log error but don't throw - fire and forget semantics
    console.error('Failed to delete item', {
      error: error instanceof Error ? error.message : 'Unknown error',
      sbId: request.sbId,
    });
  }
}

/**
 * Invoke classifier for full bootstrap sync.
 * Waits for response to report results.
 *
 * Validates: Requirements 2.1, 2.6
 */
export async function invokeSyncAll(
  config: SyncInvokerConfig,
  request: SyncAllRequest
): Promise<SyncResponse> {
  const payload = toSyncPayload(request);

  try {
    const result = await invokeClassifierSync(config, payload);
    console.log('Sync all completed', {
      success: result.success,
      itemsSynced: result.itemsSynced,
    });
    return result;
  } catch (error) {
    console.error('Failed to invoke sync all', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      itemsSynced: 0,
      itemsDeleted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Invoke classifier for health check.
 * Waits for response to report results.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
export async function invokeHealthCheck(
  config: SyncInvokerConfig,
  request: HealthCheckRequest
): Promise<SyncResponse> {
  const payload = toSyncPayload(request);

  try {
    const result = await invokeClassifierSync(config, payload);
    console.log('Health check completed', {
      success: result.success,
      inSync: result.healthReport?.inSync,
    });
    return result;
  } catch (error) {
    console.error('Failed to invoke health check', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      itemsSynced: 0,
      itemsDeleted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Invoke classifier to repair missing items.
 * Only syncs the specified sb_ids, avoiding duplicates.
 *
 * Validates: Requirements 5.1
 */
export async function invokeRepair(
  config: SyncInvokerConfig,
  request: RepairRequest
): Promise<SyncResponse> {
  const payload: SyncPayload = {
    sync_operation: 'repair',
    actor_id: request.actorId,
    missing_ids: request.missingIds,
  };

  try {
    const result = await invokeClassifierSync(config, payload);
    console.log('Repair completed', {
      success: result.success,
      itemsSynced: result.itemsSynced,
    });
    return result;
  } catch (error) {
    console.error('Failed to invoke repair', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      itemsSynced: 0,
      itemsDeleted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}