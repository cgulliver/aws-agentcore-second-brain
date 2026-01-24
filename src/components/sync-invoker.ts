/**
 * Sync Invoker
 *
 * Invokes the Python Sync Lambda for Memory operations.
 * Used by Worker Lambda after commits.
 *
 * Validates: Requirements 1.1, 2.1, 3.1, 5.1
 */

import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from '@aws-sdk/client-lambda';

// ============================================================================
// Interfaces
// ============================================================================

export interface SyncItemRequest {
  operation: 'sync_item';
  actorId: string;
  itemPath: string;
  itemContent: string;
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
  syncLambdaArn: string;
  region: string;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Lambda payload format (snake_case for Python Lambda)
 */
interface LambdaPayload {
  operation: string;
  actor_id: string;
  item_path?: string;
  item_content?: string;
  sb_id?: string;
  force_full_sync?: boolean;
}

/**
 * Lambda response format (snake_case from Python Lambda)
 */
interface LambdaResponse {
  success: boolean;
  items_synced: number;
  items_deleted: number;
  error?: string;
  health_report?: {
    codecommit_count: number;
    memory_count: number;
    in_sync: boolean;
    last_sync_timestamp: string | null;
    last_sync_commit_id: string | null;
    missing_in_memory: string[];
    extra_in_memory: string[];
  };
}

// ============================================================================
// Lambda Client Factory
// ============================================================================

let lambdaClient: LambdaClient | null = null;

/**
 * Get or create Lambda client
 */
function getLambdaClient(region: string): LambdaClient {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({ region });
  }
  return lambdaClient;
}

/**
 * Clear Lambda client (for testing)
 */
export function clearLambdaClient(): void {
  lambdaClient = null;
}

/**
 * Set Lambda client (for testing)
 */
export function setLambdaClient(client: LambdaClient): void {
  lambdaClient = client;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert camelCase request to snake_case payload for Python Lambda
 */
function toSnakeCasePayload(
  request: SyncItemRequest | DeleteItemRequest | SyncAllRequest | HealthCheckRequest
): LambdaPayload {
  const payload: LambdaPayload = {
    operation: request.operation,
    actor_id: request.actorId,
  };

  if ('itemPath' in request) {
    payload.item_path = request.itemPath;
  }
  if ('itemContent' in request) {
    payload.item_content = request.itemContent;
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
 * Convert snake_case response to camelCase SyncResponse
 */
function toCamelCaseResponse(response: LambdaResponse): SyncResponse {
  const result: SyncResponse = {
    success: response.success,
    itemsSynced: response.items_synced,
    itemsDeleted: response.items_deleted,
  };

  if (response.error) {
    result.error = response.error;
  }

  if (response.health_report) {
    result.healthReport = {
      codecommitCount: response.health_report.codecommit_count,
      memoryCount: response.health_report.memory_count,
      inSync: response.health_report.in_sync,
      lastSyncTimestamp: response.health_report.last_sync_timestamp,
      lastSyncCommitId: response.health_report.last_sync_commit_id,
      missingInMemory: response.health_report.missing_in_memory,
      extraInMemory: response.health_report.extra_in_memory,
    };
  }

  return result;
}

/**
 * Parse Lambda response payload
 */
function parseLambdaResponse(payload: Uint8Array | undefined): LambdaResponse {
  if (!payload) {
    throw new Error('Empty response from Lambda');
  }

  const responseText = new TextDecoder().decode(payload);
  const response = JSON.parse(responseText) as LambdaResponse;
  return response;
}

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Invoke sync Lambda to sync a single item after commit.
 * Fire-and-forget - doesn't block the worker response.
 *
 * Validates: Requirements 1.1, 1.3
 */
export async function invokeSyncItem(
  config: SyncInvokerConfig,
  request: SyncItemRequest
): Promise<void> {
  const client = getLambdaClient(config.region);
  const payload = toSnakeCasePayload(request);

  try {
    const command = new InvokeCommand({
      FunctionName: config.syncLambdaArn,
      InvocationType: InvocationType.Event, // Async - fire and forget
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    });

    await client.send(command);
    console.log('Sync item invoked', {
      operation: request.operation,
      itemPath: request.itemPath,
    });
  } catch (error) {
    // Log error but don't throw - fire and forget
    console.error('Failed to invoke sync item', {
      error: error instanceof Error ? error.message : 'Unknown error',
      itemPath: request.itemPath,
    });
  }
}

/**
 * Invoke sync Lambda to delete an item.
 * Fire-and-forget - doesn't block the worker response.
 *
 * Validates: Requirements 3.1, 3.2
 */
export async function invokeDeleteItem(
  config: SyncInvokerConfig,
  request: DeleteItemRequest
): Promise<void> {
  const client = getLambdaClient(config.region);
  const payload = toSnakeCasePayload(request);

  try {
    const command = new InvokeCommand({
      FunctionName: config.syncLambdaArn,
      InvocationType: InvocationType.Event, // Async - fire and forget
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    });

    await client.send(command);
    console.log('Delete item invoked', {
      operation: request.operation,
      sbId: request.sbId,
    });
  } catch (error) {
    // Log error but don't throw - fire and forget
    console.error('Failed to invoke delete item', {
      error: error instanceof Error ? error.message : 'Unknown error',
      sbId: request.sbId,
    });
  }
}

/**
 * Invoke sync Lambda for full bootstrap sync.
 * Waits for response to report results.
 *
 * Validates: Requirements 2.1, 2.6
 */
export async function invokeSyncAll(
  config: SyncInvokerConfig,
  request: SyncAllRequest
): Promise<SyncResponse> {
  const client = getLambdaClient(config.region);
  const payload = toSnakeCasePayload(request);

  try {
    const command = new InvokeCommand({
      FunctionName: config.syncLambdaArn,
      InvocationType: InvocationType.RequestResponse, // Sync - wait for response
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    });

    const result = await client.send(command);

    // Check for function error
    if (result.FunctionError) {
      const errorPayload = result.Payload
        ? new TextDecoder().decode(result.Payload)
        : 'Unknown error';
      console.error('Sync all Lambda error', { error: errorPayload });
      return {
        success: false,
        itemsSynced: 0,
        itemsDeleted: 0,
        error: 'Sync Lambda execution failed',
      };
    }

    const response = parseLambdaResponse(result.Payload);
    console.log('Sync all completed', {
      success: response.success,
      itemsSynced: response.items_synced,
    });

    return toCamelCaseResponse(response);
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
 * Invoke sync Lambda for health check.
 * Waits for response to report results.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
export async function invokeHealthCheck(
  config: SyncInvokerConfig,
  request: HealthCheckRequest
): Promise<SyncResponse> {
  const client = getLambdaClient(config.region);
  const payload = toSnakeCasePayload(request);

  try {
    const command = new InvokeCommand({
      FunctionName: config.syncLambdaArn,
      InvocationType: InvocationType.RequestResponse, // Sync - wait for response
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    });

    const result = await client.send(command);

    // Check for function error
    if (result.FunctionError) {
      const errorPayload = result.Payload
        ? new TextDecoder().decode(result.Payload)
        : 'Unknown error';
      console.error('Health check Lambda error', { error: errorPayload });
      return {
        success: false,
        itemsSynced: 0,
        itemsDeleted: 0,
        error: 'Health check Lambda execution failed',
      };
    }

    const response = parseLambdaResponse(result.Payload);
    console.log('Health check completed', {
      success: response.success,
      inSync: response.health_report?.in_sync,
    });

    return toCamelCaseResponse(response);
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
