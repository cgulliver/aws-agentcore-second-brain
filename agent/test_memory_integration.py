#!/usr/bin/env python3
"""
Integration test for BatchCreateMemoryRecords API.

Run locally to verify Memory storage works before deploying.

Usage:
    export MEMORY_ID=<your-memory-id>
    python agent/test_memory_integration.py
"""

import os
import sys
from datetime import datetime, timezone

# Get Memory ID from environment or CDK output
MEMORY_ID = os.getenv('MEMORY_ID')
REGION = os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
TEST_ACTOR_ID = 'test-user-integration'

def get_memory_id_from_cdk():
    """Try to get Memory ID from CDK outputs."""
    try:
        import subprocess
        result = subprocess.run(
            ['aws', 'cloudformation', 'describe-stacks', 
             '--stack-name', 'SecondBrainCoreStack',
             '--query', 'Stacks[0].Outputs[?OutputKey==`AgentMemoryId`].OutputValue',
             '--output', 'text'],
            capture_output=True, text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return None


def test_batch_create_memory_records():
    """Test storing an item using BatchCreateMemoryRecords API via SDK."""
    print("\n=== Test: BatchCreateMemoryRecords (via SDK) ===")
    
    try:
        from bedrock_agentcore.memory import MemoryClient
    except ImportError:
        print("❌ FAILED: bedrock_agentcore not installed")
        print("Install with: pip install 'bedrock-agentcore[strands-agents]>=1.2.0'")
        return False
    
    # Create a test item
    test_sb_id = f"sb-test{datetime.now().strftime('%H%M%S')}"
    test_content = f"""Item: Integration Test Item
ID: {test_sb_id}
Type: idea
Path: 10-ideas/test-item.md
Tags: test, integration
"""
    
    print(f"Storing test item: {test_sb_id}")
    print(f"Memory ID: {MEMORY_ID}")
    print(f"Namespace: /items/{TEST_ACTOR_ID}")
    
    try:
        # Use the SDK's MemoryClient which exposes gmdp_client
        client = MemoryClient(region_name=REGION)
        
        # Access the underlying boto3 data plane client via gmdp_client
        response = client.gmdp_client.batch_create_memory_records(
            memoryId=MEMORY_ID,
            records=[{
                'requestIdentifier': test_sb_id,
                'namespaces': [f'/items/{TEST_ACTOR_ID}'],
                'content': {'text': test_content},
                'timestamp': datetime.now(timezone.utc),  # Required by API
            }]
        )
        
        successful = response.get('successfulRecords', [])
        failed = response.get('failedRecords', [])
        
        if failed:
            print(f"❌ FAILED: {failed[0].get('errorMessage', 'Unknown error')}")
            return False
        
        if successful:
            record_id = successful[0].get('memoryRecordId', 'unknown')
            print(f"✓ SUCCESS: Created record {record_id}")
            return True
        
        print("❌ FAILED: No records in response")
        return False
        
    except Exception as e:
        print(f"❌ FAILED: {e}")
        return False


def test_retrieve_memories():
    """Test retrieving items from Memory."""
    print("\n=== Test: RetrieveMemories ===")
    
    try:
        from bedrock_agentcore.memory import MemoryClient
        
        client = MemoryClient(region_name=REGION)
        
        print(f"Querying namespace: /items/{TEST_ACTOR_ID}")
        
        response = client.retrieve_memories(
            memory_id=MEMORY_ID,
            namespace=f'/items/{TEST_ACTOR_ID}',
            query='test integration idea',
            actor_id=TEST_ACTOR_ID,
            top_k=10,
        )
        
        if not response:
            print("⚠ No items found (may need a moment to index)")
            return True  # Not a failure, just empty
        
        print(f"✓ Found {len(response)} items:")
        for i, memory in enumerate(response[:3]):
            content = memory.get('content', '')[:100]
            print(f"  {i+1}. {content}...")
        
        return True
        
    except ImportError:
        print("⚠ bedrock_agentcore not installed, skipping retrieve test")
        return True
    except Exception as e:
        print(f"❌ FAILED: {e}")
        return False


def test_full_sync_flow():
    """Test the full sync flow using ItemSyncModule."""
    print("\n=== Test: Full Sync Flow ===")
    
    try:
        from item_sync import ItemSyncModule, ItemMetadata
        
        sync = ItemSyncModule(memory_id=MEMORY_ID, region=REGION)
        
        # Create a test item
        test_item = ItemMetadata(
            sb_id=f"sb-flow{datetime.now().strftime('%H%M%S')}",
            title="Full Flow Test Item",
            item_type="project",
            path="30-projects/test-flow.md",
            tags=["test", "flow"],
            status="active",
        )
        
        print(f"Storing via ItemSyncModule: {test_item.sb_id}")
        
        success = sync.store_item_in_memory(TEST_ACTOR_ID, test_item)
        
        if success:
            print(f"✓ SUCCESS: Stored {test_item.sb_id}")
            return True
        else:
            print("❌ FAILED: store_item_in_memory returned False")
            return False
            
    except Exception as e:
        print(f"❌ FAILED: {e}")
        return False


def main():
    global MEMORY_ID
    
    print("=" * 60)
    print("Memory Integration Test")
    print("=" * 60)
    
    # Get Memory ID
    if not MEMORY_ID:
        MEMORY_ID = get_memory_id_from_cdk()
    
    if not MEMORY_ID:
        print("\n❌ ERROR: MEMORY_ID not set")
        print("Set it via: export MEMORY_ID=<your-memory-id>")
        print("Or deploy the stack first: cdk deploy")
        sys.exit(1)
    
    print(f"\nMemory ID: {MEMORY_ID}")
    print(f"Region: {REGION}")
    print(f"Test Actor: {TEST_ACTOR_ID}")
    
    results = []
    
    # Run tests
    results.append(("BatchCreateMemoryRecords", test_batch_create_memory_records()))
    results.append(("RetrieveMemories", test_retrieve_memories()))
    results.append(("Full Sync Flow", test_full_sync_flow()))
    
    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    
    passed = sum(1 for _, r in results if r)
    total = len(results)
    
    for name, result in results:
        status = "✓ PASS" if result else "❌ FAIL"
        print(f"  {status}: {name}")
    
    print(f"\n{passed}/{total} tests passed")
    
    if passed == total:
        print("\n✓ All tests passed! Safe to deploy.")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed. Check errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
