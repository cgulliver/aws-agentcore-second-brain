"""
Second Brain Classifier Agent

Containerized AgentCore Runtime that classifies messages and generates Action Plans.
Uses Strands Agents with Bedrock for LLM inference.

Validates: Requirements 6.3, 42.1
"""

import json
import os
from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

# Environment variables
KNOWLEDGE_REPO_NAME = os.getenv('KNOWLEDGE_REPO_NAME', 'second-brain-knowledge')
AWS_REGION = os.getenv('AWS_DEFAULT_REGION', 'us-east-1')


def create_classifier_agent(system_prompt: str) -> Agent:
    """Create a classifier agent with the provided system prompt."""
    return Agent(
        system_prompt=system_prompt,
        name="SecondBrainClassifier"
    )


def validate_action_plan(plan: dict) -> list[str]:
    """Validate Action Plan structure and return list of errors."""
    errors = []
    
    # Required fields
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
        "session_id": "optional session identifier"
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
        
        # Create agent with system prompt
        agent = create_classifier_agent(system_prompt)
        
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
        
        return {
            "status": "success",
            "action_plan": action_plan
        }
        
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }


if __name__ == "__main__":
    app.run()
