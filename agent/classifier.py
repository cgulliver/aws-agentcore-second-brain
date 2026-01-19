"""
Second Brain Classifier Agent

Containerized AgentCore Runtime that classifies messages and generates Action Plans.
Uses Strands Agents with Bedrock for LLM inference.
Integrates with AgentCore Memory for behavioral learning (v2).

Validates: Requirements 6.3, 42.1, 58.1, 58.2
"""

import json
import os
from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# AgentCore Memory integration (Task 25.1)
try:
    from bedrock_agentcore.memory import MemoryClient
    from bedrock_agentcore.memory.integrations.strands.config import (
        AgentCoreMemoryConfig,
        RetrievalConfig,
    )
    from bedrock_agentcore.memory.integrations.strands.session_manager import (
        AgentCoreMemorySessionManager,
    )
    MEMORY_AVAILABLE = True
except ImportError:
    MEMORY_AVAILABLE = False

app = BedrockAgentCoreApp()

# Environment variables
KNOWLEDGE_REPO_NAME = os.getenv('KNOWLEDGE_REPO_NAME', 'second-brain-knowledge')
AWS_REGION = os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
MEMORY_ID = os.getenv('MEMORY_ID', '')  # Task 31.2: Memory ID from CDK


def create_session_manager(user_id: str, session_id: str):
    """
    Create AgentCore Memory session manager for behavioral learning.
    
    Task 25.1: Configure AgentCoreMemoryConfig with memory_id from environment.
    Task 25.2: Configure retrieval for user preferences.
    
    Args:
        user_id: Slack user_id mapped to actor_id
        session_id: Conversation session identifier
    
    Returns:
        AgentCoreMemorySessionManager or None if Memory not available
    """
    if not MEMORY_AVAILABLE or not MEMORY_ID:
        return None
    
    try:
        # Task 25.2: Configure retrieval for preferences namespace
        config = AgentCoreMemoryConfig(
            memory_id=MEMORY_ID,
            session_id=session_id,
            actor_id=user_id,
            retrieval_config={
                '/preferences/{actorId}': RetrievalConfig(
                    top_k=5,
                    relevance_score=0.7,
                ),
                '/patterns/{actorId}': RetrievalConfig(
                    top_k=10,
                    relevance_score=0.5,
                ),
            },
        )
        
        return AgentCoreMemorySessionManager(
            agentcore_memory_config=config,
            region_name=AWS_REGION,
        )
    except Exception as e:
        # Log but don't fail - Memory is optional
        print(f"Warning: Failed to create Memory session manager: {e}")
        return None


def create_classifier_agent(system_prompt: str, session_manager=None) -> Agent:
    """
    Create a classifier agent with the provided system prompt.
    
    Args:
        system_prompt: The system prompt defining agent behavior
        session_manager: Optional AgentCoreMemorySessionManager for behavioral learning
    
    Returns:
        Configured Strands Agent
    """
    agent_kwargs = {
        'system_prompt': system_prompt,
        'name': 'SecondBrainClassifier',
    }
    
    # Add session manager if Memory is available (Task 25.1)
    if session_manager:
        agent_kwargs['session_manager'] = session_manager
    
    return Agent(**agent_kwargs)


def validate_action_plan(plan: dict) -> list[str]:
    """Validate Action Plan structure and return list of errors."""
    errors = []
    
    # Check intent (Phase 2) - defaults to 'capture' for backward compatibility
    intent = plan.get('intent', 'capture')
    valid_intents = ['capture', 'query']
    if intent not in valid_intents:
        errors.append(f"Invalid intent: {intent}. Must be one of: {valid_intents}")
    
    # Validate intent_confidence if present
    if 'intent_confidence' in plan:
        try:
            intent_conf = float(plan['intent_confidence'])
            if intent_conf < 0.0 or intent_conf > 1.0:
                errors.append(f"Intent confidence out of range [0, 1]: {intent_conf}")
        except (TypeError, ValueError):
            errors.append(f"Invalid intent_confidence value: {plan['intent_confidence']}")
    
    # For query intent, different validation rules apply
    if intent == 'query':
        # Query intent doesn't require classification, title, content, file_operations
        # query_response and cited_files are populated by the worker after search
        # Just ensure no file_operations are specified
        if plan.get('file_operations') and len(plan.get('file_operations', [])) > 0:
            errors.append("Query intent must not have file_operations")
        return errors
    
    # For capture intent, validate required fields
    required_fields = ['classification', 'confidence', 'reasoning', 'title', 'content']
    for field in required_fields:
        if field not in plan:
            errors.append(f"Missing required field: {field}")
    
    # Classification validation
    valid_classifications = ['inbox', 'idea', 'decision', 'project', 'task']
    if 'classification' in plan and plan['classification'] not in valid_classifications:
        errors.append(f"Invalid classification: {plan['classification']}")
    
    # Confidence validation
    if 'confidence' in plan:
        try:
            confidence = float(plan['confidence'])
            if confidence < 0.0 or confidence > 1.0:
                errors.append(f"Confidence out of range [0, 1]: {confidence}")
        except (TypeError, ValueError):
            errors.append(f"Invalid confidence value: {plan['confidence']}")
    
    # Note: Front matter validation removed from classifier (Task 11.2 revision)
    # The TypeScript side generates proper SB_IDs and front matter.
    # LLMs cannot reliably generate random hex values for SB_IDs.
    # The classifier focuses on classification; the worker adds front matter.
    
    return errors


def validate_front_matter(content: str, expected_type: str) -> list[str]:
    """
    Validate YAML front matter in markdown content.
    
    Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
    
    Args:
        content: Markdown content that should contain front matter
        expected_type: Expected type field value (idea, decision, project)
    
    Returns:
        List of validation errors (empty if valid)
    """
    import re
    errors = []
    
    # Check if content starts with front matter
    if not content.startswith('---\n'):
        errors.append("Content must start with YAML front matter (---)")
        return errors
    
    # Find the closing ---
    end_match = re.search(r'\n---\n', content[4:])
    if not end_match:
        errors.append("Front matter must have closing delimiter (---)")
        return errors
    
    yaml_block = content[4:4 + end_match.start()]
    
    # Parse front matter fields
    fields = {}
    for line in yaml_block.split('\n'):
        match = re.match(r'^(\w+):\s*(.*)$', line)
        if match:
            fields[match.group(1)] = match.group(2).strip()
    
    # Requirement 9.1: Validate id matches SB_ID format
    if 'id' not in fields:
        errors.append("Front matter missing required field: id")
    else:
        sb_id = fields['id']
        if not re.match(r'^sb-[a-f0-9]{7}$', sb_id):
            errors.append(f"Invalid SB_ID format: {sb_id}. Must match sb-[a-f0-9]{{7}}")
    
    # Requirement 9.2: Validate type matches classification
    if 'type' not in fields:
        errors.append("Front matter missing required field: type")
    elif fields['type'] != expected_type:
        errors.append(f"Front matter type '{fields['type']}' does not match classification '{expected_type}'")
    
    # Requirement 9.3: Validate created_at is valid ISO-8601
    if 'created_at' not in fields:
        errors.append("Front matter missing required field: created_at")
    else:
        created_at = fields['created_at']
        # Basic ISO-8601 validation
        iso_pattern = r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$'
        if not re.match(iso_pattern, created_at):
            errors.append(f"Invalid created_at format: {created_at}. Must be ISO-8601")
    
    # Requirement 9.4: Validate tags is present (array validation is complex in YAML)
    if 'tags' not in fields and 'tags:' not in yaml_block:
        errors.append("Front matter missing required field: tags")
    
    # Validate title is present
    if 'title' not in fields:
        errors.append("Front matter missing required field: title")
    
    return errors


def extract_json_from_response(response_text: str) -> dict | None:
    """Extract JSON from LLM response, handling markdown code blocks."""
    # Try to find JSON in code blocks
    import re
    
    # Look for ```json ... ``` blocks
    json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1).strip())
        except json.JSONDecodeError:
            pass
    
    # Try to parse the entire response as JSON
    try:
        return json.loads(response_text.strip())
    except json.JSONDecodeError:
        pass
    
    # Try to find any JSON object in the response
    json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass
    
    return None


@app.entrypoint
async def invoke(payload=None):
    """
    Main entrypoint for the classifier agent.
    
    Expected payload:
    {
        "prompt": "User message to classify",
        "system_prompt": "System prompt content",
        "session_id": "optional session identifier",
        "user_id": "Slack user_id for Memory actor_id"
    }
    
    Returns Action Plan JSON.
    """
    try:
        if not payload:
            return {
                "status": "error",
                "error": "No payload provided"
            }
        
        user_message = payload.get("prompt", "")
        system_prompt = payload.get("system_prompt", "")
        session_id = payload.get("session_id", "default")
        user_id = payload.get("user_id", "anonymous")  # Task 25.1: Map to actor_id
        
        if not user_message:
            return {
                "status": "error",
                "error": "No prompt provided in payload"
            }
        
        if not system_prompt:
            # Use minimal fallback prompt
            system_prompt = """You are a message classifier. Classify the message and return a JSON Action Plan with:
            - classification: one of inbox, idea, decision, project, task
            - confidence: 0.0 to 1.0
            - reasoning: brief explanation
            - title: short title
            - content: formatted content
            - file_operations: array of file operations
            Return only valid JSON."""
        
        # Task 25.1: Create session manager for Memory integration
        session_manager = create_session_manager(user_id, session_id)
        
        # Create agent with system prompt and optional Memory
        agent = create_classifier_agent(system_prompt, session_manager)
        
        # Invoke agent
        response = agent(user_message)
        response_text = response.message['content'][0]['text']
        
        # Extract JSON from response
        action_plan = extract_json_from_response(response_text)
        
        if not action_plan:
            return {
                "status": "error",
                "error": "Failed to extract valid JSON from agent response",
                "raw_response": response_text[:500]  # Truncate for logging
            }
        
        # Validate Action Plan
        validation_errors = validate_action_plan(action_plan)
        
        if validation_errors:
            return {
                "status": "error",
                "error": "Action Plan validation failed",
                "validation_errors": validation_errors,
                "action_plan": action_plan
            }
        
        # Include memory status in response
        memory_enabled = session_manager is not None
        
        return {
            "status": "success",
            "action_plan": action_plan,
            "memory_enabled": memory_enabled,
        }
        
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }


def record_fix_preference(user_id: str, original_classification: str, corrected_classification: str, context: str):
    """
    Task 31.3: Record a fix command as a learned preference.
    
    When a user corrects a classification via fix: command, we store this
    as a preference so the agent can learn from it.
    
    Args:
        user_id: Slack user_id (actor_id)
        original_classification: What the agent originally classified as
        corrected_classification: What the user corrected it to
        context: Brief context about the message (for pattern matching)
    """
    if not MEMORY_AVAILABLE or not MEMORY_ID:
        return
    
    try:
        client = MemoryClient(region_name=AWS_REGION)
        
        # Store the correction as a preference
        # The Memory strategies will extract and consolidate this over time
        preference_text = (
            f"User prefers '{corrected_classification}' over '{original_classification}' "
            f"for messages like: {context[:100]}"
        )
        
        # This will be processed by userPreferenceMemoryStrategy
        # and stored in /preferences/{actorId} namespace
        client.create_event(
            memory_id=MEMORY_ID,
            actor_id=user_id,
            session_id=f"fix-{user_id}",
            event_type="preference_correction",
            content=preference_text,
        )
    except Exception as e:
        # Log but don't fail - preference learning is optional
        print(f"Warning: Failed to record fix preference: {e}")


if __name__ == "__main__":
    app.run()
