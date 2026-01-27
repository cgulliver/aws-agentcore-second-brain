/**
 * System Prompt Loader Component
 * 
 * Loads and validates the system prompt from CodeCommit.
 * Provides fallback behavior and caching.
 * 
 * Validates: Requirements 40, 41, 45
 */

import { createHash } from 'crypto';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { readFile, getLatestCommitId, type KnowledgeStoreConfig } from './knowledge-store';

const cloudWatchClient = new CloudWatchClient({});

// System prompt configuration
export interface SystemPromptConfig {
  repositoryName: string;
  branchName: string;
  promptPath: string;
}

// System prompt metadata
export interface SystemPromptMetadata {
  commitId: string;
  sha256: string;
  loadedAt: string;
}

// Full system prompt with metadata
export interface SystemPrompt {
  content: string;
  metadata: SystemPromptMetadata;
}

// Validation result
export interface PromptValidationResult {
  valid: boolean;
  warnings: string[];
  missingSections: string[];
}

// Default prompt path
const DEFAULT_PROMPT_PATH = 'system/agent-system-prompt.md';

// Required sections for validation
const REQUIRED_SECTIONS = [
  'Role',
  'Classification Rules',
  'Output Contract',
];

// Minimal safe prompt for fallback
const MINIMAL_SAFE_PROMPT = `# Minimal Safe Prompt

## Role
You are a message classifier. Classify messages and return structured JSON.

## Classification Rules
- inbox: Quick notes and observations
- idea: Conceptual insights
- decision: Explicit commitments
- project: Multi-step initiatives
- task: Actionable items

## Output Contract
Return valid JSON with: classification, confidence, reasoning, title, content, file_operations.

## Hard Constraints
- Return valid JSON only
- Confidence must be 0.0 to 1.0
- Classification must be one of: inbox, idea, decision, project, task
`;

// Cache for system prompt
let cachedPrompt: SystemPrompt | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Compute SHA-256 hash of content
 * 
 * Validates: Requirements 45.1, 45.2
 */
export function computePromptHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Validate prompt structure
 * 
 * Validates: Requirements 41
 */
export function validatePromptStructure(content: string): PromptValidationResult {
  const warnings: string[] = [];
  const missingSections: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    // Check for section header (## Section or # Section)
    const sectionRegex = new RegExp(`^#+\\s*${section}`, 'im');
    if (!sectionRegex.test(content)) {
      missingSections.push(section);
      warnings.push(`Missing required section: ${section}`);
    }
  }

  return {
    valid: missingSections.length === 0,
    warnings,
    missingSections,
  };
}

/**
 * Replace date placeholders in prompt content
 * 
 * Replaces {TODAY} with the current date in YYYY-MM-DD format.
 * This ensures examples in the prompt use the actual current date
 * rather than hardcoded dates that the LLM might copy.
 */
function replaceDatePlaceholders(content: string): string {
  const today = new Date().toISOString().split('T')[0];
  return content.replace(/\{TODAY\}/g, today);
}

/**
 * Load system prompt from CodeCommit
 * 
 * Validates: Requirements 40.1, 40.2
 */
export async function loadSystemPrompt(
  config: SystemPromptConfig
): Promise<SystemPrompt> {
  // Check cache
  if (cachedPrompt && Date.now() < cacheExpiry) {
    return cachedPrompt;
  }

  const knowledgeConfig: KnowledgeStoreConfig = {
    repositoryName: config.repositoryName,
    branchName: config.branchName,
  };

  try {
    const promptPath = config.promptPath || DEFAULT_PROMPT_PATH;
    let content = await readFile(knowledgeConfig, promptPath);
    const commitId = await getLatestCommitId(knowledgeConfig);

    if (!content) {
      console.error('System prompt file not found, using fallback', {
        path: promptPath,
        repository: config.repositoryName,
      });
      return await createFallbackPrompt();
    }

    // Replace date placeholders with actual current date
    content = replaceDatePlaceholders(content);

    // Validate structure
    const validation = validatePromptStructure(content);
    if (!validation.valid) {
      console.warn('System prompt validation warnings', {
        warnings: validation.warnings,
        missingSections: validation.missingSections,
      });
    }

    const prompt: SystemPrompt = {
      content,
      metadata: {
        commitId: commitId || 'unknown',
        sha256: computePromptHash(content),
        loadedAt: new Date().toISOString(),
      },
    };

    // Update cache
    cachedPrompt = prompt;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return prompt;
  } catch (error) {
    console.error('Failed to load system prompt, using fallback', { error });
    return await createFallbackPrompt();
  }
}

/**
 * Create fallback prompt when loading fails
 * 
 * Validates: Requirements 40.5, 40.6
 */
async function createFallbackPrompt(): Promise<SystemPrompt> {
  console.error('Using minimal safe prompt fallback');
  
  // Emit CloudWatch metric for prompt load failure
  try {
    await cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: 'SecondBrain',
      MetricData: [{
        MetricName: 'SystemPromptLoadFailure',
        Value: 1,
        Unit: 'Count',
        Dimensions: [{ Name: 'Component', Value: 'SystemPromptLoader' }],
      }],
    }));
  } catch (metricError) {
    console.error('Failed to emit CloudWatch metric:', metricError);
  }

  return {
    content: MINIMAL_SAFE_PROMPT,
    metadata: {
      commitId: 'fallback',
      sha256: computePromptHash(MINIMAL_SAFE_PROMPT),
      loadedAt: new Date().toISOString(),
    },
  };
}

/**
 * Clear prompt cache (for testing or forced refresh)
 */
export function clearPromptCache(): void {
  cachedPrompt = null;
  cacheExpiry = 0;
}

/**
 * Get cached prompt without loading (for testing)
 */
export function getCachedPrompt(): SystemPrompt | null {
  if (cachedPrompt && Date.now() < cacheExpiry) {
    return cachedPrompt;
  }
  return null;
}
