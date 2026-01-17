# AgentCore Reference Samples

These files are copied from [amazon-bedrock-agentcore-samples](https://github.com/awslabs/amazon-bedrock-agentcore-samples) for implementation reference.

## Files

### `basic_agent.py`
Minimal AgentCore agent pattern showing:
- `BedrockAgentCoreApp` setup
- `@app.entrypoint` decorator
- Strands Agent integration
- Payload handling

### `weather_agent.py`
Full-featured agent showing:
- Multiple tools (`@tool` decorator)
- Memory integration (`MemoryClient`)
- Browser and Code Interpreter tools
- Async task handling (`@app.async_task`)

### `weather_agent_stack.py`
CDK stack (Python) showing:
- `aws_bedrockagentcore.CfnRuntime` for agent runtime
- `aws_bedrockagentcore.CfnMemory` for memory
- `aws_bedrockagentcore.CfnBrowserCustom` for browser tool
- `aws_bedrockagentcore.CfnCodeInterpreterCustom` for code interpreter
- ECR repository for container images
- CodeBuild for image building
- Custom resources for initialization

### `memory-overview.md`
AgentCore Memory documentation covering:
- Short-Term Memory (STM) - session context
- Long-Term Memory (LTM) - persistent facts/preferences
- Memory strategies: Semantic, Summary, User Preference, Custom

## Key Patterns for Second Brain Agent

### Agent Entry Point
```python
from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@app.entrypoint
async def invoke(payload=None):
    query = payload.get("prompt", "")
    agent = Agent(system_prompt=SYSTEM_PROMPT)
    response = agent(query)
    return {"result": response.message['content'][0]['text']}

if __name__ == "__main__":
    app.run()
```

### CDK Memory Resource
```python
from aws_cdk import aws_bedrockagentcore as bedrockagentcore

memory = bedrockagentcore.CfnMemory(self, "Memory",
    name="second_brain_memory",
    description="Memory for Second Brain agent",
    event_expiry_duration=30  # days
)
```

### CDK Runtime Resource
```python
agent_runtime = bedrockagentcore.CfnRuntime(self, "AgentRuntime",
    agent_runtime_name="second_brain_agent",
    agent_runtime_artifact=bedrockagentcore.CfnRuntime.AgentRuntimeArtifactProperty(
        container_configuration=bedrockagentcore.CfnRuntime.ContainerConfigurationProperty(
            container_uri=f"{ecr_repository.repository_uri}:latest"
        )
    ),
    network_configuration=bedrockagentcore.CfnRuntime.NetworkConfigurationProperty(
        network_mode="PUBLIC"
    ),
    protocol_configuration="HTTP",
    role_arn=agent_role.role_arn,
    environment_variables={
        "MEMORY_ID": memory.attr_memory_id,
    }
)
```

## Notes

- Our Second Brain Agent uses **containerized AgentCore Runtime** pattern
- Lambda invokes AgentCore via `boto3.client('bedrock-agentcore').invoke_agent_runtime()`
- AgentCore Memory is optional for v1 (DynamoDB handles conversation context)
- These samples show the full AgentCore patterns used in our implementation
