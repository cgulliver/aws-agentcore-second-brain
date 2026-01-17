/**
 * Bootstrap Custom Resource Handler
 * 
 * Seeds the CodeCommit repository with:
 * - Folder structure: 00-inbox/, 10-ideas/, 20-decisions/, 30-projects/, 90-receipts/, system/
 * - Default system prompt: system/agent-system-prompt.md
 * 
 * Validates: Requirements 29, 40
 */

import {
  CodeCommitClient,
  GetBranchCommand,
  CreateCommitCommand,
  GetFileCommand,
  BranchDoesNotExistException,
} from '@aws-sdk/client-codecommit';
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from 'aws-lambda';

const REPOSITORY_NAME = process.env.REPOSITORY_NAME!;

const codecommitClient = new CodeCommitClient({});

// Default system prompt content
const DEFAULT_SYSTEM_PROMPT = `# Second Brain Agent System Prompt

## Role

You are a personal knowledge management assistant. Your job is to classify incoming messages and generate structured Action Plans for the orchestrator to execute.

## Core Responsibilities

1. **Classify** each message into one of: inbox, idea, decision, project, task
2. **Generate** a confidence score (0.0 to 1.0) for your classification
3. **Create** an Action Plan with file operations and metadata
4. **Explain** your reasoning briefly

## Classification Rules

### inbox
- Quick thoughts, notes, or observations that don't fit other categories
- Default classification when uncertain
- Signals: "note to self", "reminder", stream of consciousness

### idea
- Conceptual insights, observations, or hypotheses
- Things worth exploring or remembering
- Signals: "I think", "what if", "interesting that", observations about patterns

### decision
- Explicit commitments or choices made
- Things that affect future behavior
- Signals: "I've decided", "going to", "will", "won't", commitment language

### project
- Multi-step initiatives with clear objectives
- Ongoing work that needs tracking
- Signals: project names, milestones, "working on", "building"

### task
- Actionable items with clear completion criteria
- Things that need to be done
- Signals: "need to", "should", "must", "todo", imperative verbs

## Confidence Scoring

- **High (≥ 0.85)**: Clear signals, unambiguous classification
- **Medium (0.70-0.84)**: Some signals present, reasonable confidence
- **Low (< 0.70)**: Ambiguous, multiple possible classifications

## Output Contract

You MUST return a valid JSON Action Plan with this structure:

\`\`\`json
{
  "classification": "inbox|idea|decision|project|task",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "title": "Short title for the item",
  "content": "Formatted content for the file",
  "suggested_slug": "optional-slug-for-filename",
  "file_operations": [
    {
      "operation": "create|append",
      "path": "path/to/file.md",
      "content": "Content to write"
    }
  ],
  "task_details": {
    "title": "Task title (for task classification only)",
    "context": "Additional context"
  }
}
\`\`\`

## Hard Constraints

- NEVER execute side effects yourself
- ALWAYS return valid JSON
- NEVER include PII in reasoning
- ALWAYS use ISO 8601 dates (YYYY-MM-DD)
- NEVER use emojis in file content

## Forbidden Behaviors

- Do not ask clarifying questions in the Action Plan
- Do not refuse to classify (use inbox as fallback)
- Do not include conversation history in file content
- Do not generate content unrelated to the input message
`;

// Folder structure with .gitkeep files
const FOLDER_STRUCTURE = [
  '00-inbox/.gitkeep',
  '10-ideas/.gitkeep',
  '20-decisions/.gitkeep',
  '30-projects/.gitkeep',
  '90-receipts/.gitkeep',
  'system/.gitkeep',
];

/**
 * Check if repository has any commits
 */
async function hasCommits(): Promise<boolean> {
  try {
    await codecommitClient.send(
      new GetBranchCommand({
        repositoryName: REPOSITORY_NAME,
        branchName: 'main',
      })
    );
    return true;
  } catch (error) {
    if (error instanceof BranchDoesNotExistException) {
      return false;
    }
    throw error;
  }
}

/**
 * Check if system prompt already exists
 */
async function systemPromptExists(): Promise<boolean> {
  try {
    await codecommitClient.send(
      new GetFileCommand({
        repositoryName: REPOSITORY_NAME,
        filePath: 'system/agent-system-prompt.md',
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Create initial commit with folder structure and system prompt
 */
async function bootstrapRepository(): Promise<string> {
  const putFiles = [
    // Folder structure
    ...FOLDER_STRUCTURE.map((path) => ({
      filePath: path,
      fileContent: Buffer.from(''),
    })),
    // System prompt
    {
      filePath: 'system/agent-system-prompt.md',
      fileContent: Buffer.from(DEFAULT_SYSTEM_PROMPT),
    },
  ];

  const response = await codecommitClient.send(
    new CreateCommitCommand({
      repositoryName: REPOSITORY_NAME,
      branchName: 'main',
      authorName: 'Second Brain Bootstrap',
      email: 'bootstrap@second-brain.local',
      commitMessage: 'Initial repository setup with folder structure and system prompt',
      putFiles,
    })
  );

  return response.commitId || 'unknown';
}

/**
 * Lambda handler for CloudFormation custom resource
 */
export async function handler(
  event: CloudFormationCustomResourceEvent
): Promise<CloudFormationCustomResourceResponse> {
  console.log('Bootstrap event:', JSON.stringify(event, null, 2));

  const physicalResourceId = `bootstrap-${REPOSITORY_NAME}`;

  try {
    if (event.RequestType === 'Delete') {
      // Nothing to clean up on delete
      return {
        Status: 'SUCCESS',
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
      };
    }

    // For Create and Update, check if bootstrap is needed
    const repoHasCommits = await hasCommits();
    
    if (!repoHasCommits) {
      console.log('Repository is empty, bootstrapping...');
      const commitId = await bootstrapRepository();
      console.log('Bootstrap complete, commit:', commitId);
      
      return {
        Status: 'SUCCESS',
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: {
          CommitId: commitId,
          Bootstrapped: 'true',
        },
      };
    }

    // Repository has commits, check if system prompt exists
    const promptExists = await systemPromptExists();
    
    if (!promptExists) {
      console.log('System prompt missing, this should not happen in normal operation');
      // Don't auto-create to avoid overwriting user changes
    }

    console.log('Repository already initialized, skipping bootstrap');
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {
        Bootstrapped: 'false',
        Message: 'Repository already initialized',
      },
    };
  } catch (error) {
    console.error('Bootstrap failed:', error);
    return {
      Status: 'FAILED',
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Reason: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
