"""
Sync Lambda Handler

Exposes ItemSyncModule for invocation from Worker Lambda.
Handles both single-item sync (after commits) and full sync (bootstrap).

Validates: Requirements 1.1, 2.1, 3.1, 5.1
"""

import os
import logging
from typing import Optional

from item_sync import ItemSyncModule, SyncResult

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Environment variables
MEMORY_ID = os.getenv('MEMORY_ID', '')
KNOWLEDGE_REPO_NAME = os.getenv('KNOWLEDGE_REPO_NAME', 'second-brain-knowledge')
AWS_REGION = os.getenv('AWS_REGION', os.getenv('AWS_DEFAULT_REGION', 'us-east-1'))


def handler(event: dict, context) -> dict:
    """
    Lambda handler for sync operations.
    
    Event types:
    - sync_item: Sync a single item after commit
    - sync_all: Full bootstrap sync
    - delete_item: Remove item from Memory
    - health_check: Compare CodeCommit vs Memory counts
    
    Args:
        event: {
            "operation": "sync_item" | "sync_all" | "delete_item" | "health_check",
            "actor_id": str,
            "item_path": str (for sync_item),
            "item_content": str (for sync_item),
            "sb_id": str (for delete_item),
            "force_full_sync": bool (for sync_all)
        }
    
    Returns:
        {
            "success": bool,
            "items_synced": int,
            "items_deleted": int,
            "error": str | None,
            "health_report": dict | None (for health_check)
        }
        
    Validates: Requirements 1.1, 2.1, 3.1, 5.1
    """
    logger.info(f"Sync handler invoked with operation: {event.get('operation')}")
    
    # Validate required fields
    operation = event.get('operation')
    actor_id = event.get('actor_id')
    
    if not operation:
        return _error_response("Missing required field: operation")
    
    if not actor_id:
        return _error_response("Missing required field: actor_id")
    
    # Initialize sync module
    if not MEMORY_ID:
        return _error_response("MEMORY_ID environment variable not set")
    
    sync_module = ItemSyncModule(memory_id=MEMORY_ID, region=AWS_REGION)
    
    # Route to appropriate operation
    if operation == 'sync_item':
        return _handle_sync_item(sync_module, event)
    elif operation == 'sync_all':
        return _handle_sync_all(sync_module, event)
    elif operation == 'delete_item':
        return _handle_delete_item(sync_module, event)
    elif operation == 'health_check':
        return _handle_health_check(sync_module, event)
    else:
        return _error_response(f"Unknown operation: {operation}")


def _handle_sync_item(sync_module: ItemSyncModule, event: dict) -> dict:
    """
    Handle single-item sync operation.
    
    Args:
        sync_module: Initialized ItemSyncModule
        event: Event with item_path and item_content
        
    Returns:
        Response dict with success status
        
    Validates: Requirements 1.1, 1.2, 1.3
    """
    actor_id = event.get('actor_id')
    item_path = event.get('item_path')
    item_content = event.get('item_content')
    
    if not item_path:
        return _error_response("Missing required field: item_path")
    
    if not item_content:
        return _error_response("Missing required field: item_content")
    
    logger.info(f"Syncing single item: {item_path}")
    
    try:
        result = sync_module.sync_single_item(actor_id, item_path, item_content)
        return _success_response(result)
    except Exception as e:
        logger.error(f"Error syncing item: {e}")
        return _error_response(f"Failed to sync item: {str(e)}")


def _handle_sync_all(sync_module: ItemSyncModule, event: dict) -> dict:
    """
    Handle full bootstrap sync operation.
    
    Args:
        sync_module: Initialized ItemSyncModule
        event: Event with actor_id and optional force_full_sync
        
    Returns:
        Response dict with sync results
        
    Validates: Requirements 2.1, 2.2, 2.3
    """
    actor_id = event.get('actor_id')
    force_full_sync = event.get('force_full_sync', False)
    
    logger.info(f"Running full sync for actor: {actor_id}, force={force_full_sync}")
    
    try:
        # Use existing sync_items method for full sync
        result = sync_module.sync_items(actor_id)
        return _success_response(result)
    except Exception as e:
        logger.error(f"Error during full sync: {e}")
        return _error_response(f"Failed to complete sync: {str(e)}")


def _handle_delete_item(sync_module: ItemSyncModule, event: dict) -> dict:
    """
    Handle item deletion operation.
    
    Args:
        sync_module: Initialized ItemSyncModule
        event: Event with sb_id
        
    Returns:
        Response dict with deletion status
        
    Validates: Requirements 3.1, 3.2
    """
    actor_id = event.get('actor_id')
    sb_id = event.get('sb_id')
    
    if not sb_id:
        return _error_response("Missing required field: sb_id")
    
    logger.info(f"Deleting item: {sb_id}")
    
    try:
        success = sync_module.delete_item_from_memory(actor_id, sb_id)
        return {
            "success": success,
            "items_synced": 0,
            "items_deleted": 1 if success else 0,
            "error": None,
            "health_report": None,
        }
    except Exception as e:
        logger.error(f"Error deleting item: {e}")
        return _error_response(f"Failed to delete item: {str(e)}")


def _handle_health_check(sync_module: ItemSyncModule, event: dict) -> dict:
    """
    Handle health check operation.
    
    Args:
        sync_module: Initialized ItemSyncModule
        event: Event with actor_id
        
    Returns:
        Response dict with health report
        
    Validates: Requirements 5.1, 5.2, 5.3
    """
    actor_id = event.get('actor_id')
    
    logger.info(f"Running health check for actor: {actor_id}")
    
    try:
        health_report = sync_module.get_health_report(actor_id)
        return {
            "success": True,
            "items_synced": 0,
            "items_deleted": 0,
            "error": None,
            "health_report": health_report,
        }
    except Exception as e:
        logger.error(f"Error during health check: {e}")
        return _error_response(f"Failed to complete health check: {str(e)}")


def _success_response(result: SyncResult) -> dict:
    """
    Convert SyncResult to response dict.
    
    Args:
        result: SyncResult from sync operation
        
    Returns:
        Response dict
    """
    return {
        "success": result.success,
        "items_synced": result.items_synced,
        "items_deleted": result.items_deleted,
        "error": result.error,
        "health_report": None,
    }


def _error_response(error_message: str) -> dict:
    """
    Create error response dict.
    
    Args:
        error_message: Error message to include
        
    Returns:
        Response dict with error
    """
    return {
        "success": False,
        "items_synced": 0,
        "items_deleted": 0,
        "error": error_message,
        "health_report": None,
    }
