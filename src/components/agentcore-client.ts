/**
 * AgentCore Client Component
 * 
 * Invokes AgentCore Runtime for message classification.
 * Handles streaming responses and rate limiting.
 * 
 * Note: Uses HTTP invocation since AgentCore SDK may not be available.
 * In production, this would use the official bedrock-agentcore SDK.
 * 
 * Validates: Requirements 6.3, 7, 8, 50.6, 50.7
 */

import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { ActionPlan, MultiItemResponse } from './action-plan';
import { parseActionPlanFromLLM, isMultiItemResponse } from './action-plan';

// AgentCore invocation configuration
export interface AgentCoreConfig {
  agentRuntimeArn: string;
  region: string;
}

// Invocation payload
export interface InvocationPayload {
  prompt: string;
  system_prompt: string;
  session_id?: string;
  user_id?: string;
}

// Invocation result - can be single or multi-item
export interface InvocationResult {
  success: boolean;
  actionPlan?: ActionPlan;
  multiItemResponse?: MultiItemResponse;
  error?: string;
  rawResponse?: string;
}

// Confidence thresholds
export const CONFIDENCE_THRESHOLDS = {
  LOW: 0.5,  // Lowered from 0.7 - trust the LLM more
  HIGH: 0.85,
};

// Rate limit configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * Parse AgentCore ARN to extract runtime ID
 */
function parseAgentRuntimeArn(arn: string): { region: string; runtimeId: string } {
  // ARN format: arn:aws:bedrock-agentcore:region:account:runtime/runtime-id
  const parts = arn.split(':');
  const region = parts[3];
  const runtimeId = parts[5] || '';
  return { region, runtimeId };
}

/**
 * Invoke AgentCore Runtime via HTTP
 * 
 * Validates: Requirements 6.3, 50.6, 50.7
 */
export async function invokeAgentRuntime(
  config: AgentCoreConfig,
  payload: InvocationPayload
): Promise<InvocationResult> {
  const { region } = parseAgentRuntimeArn(config.agentRuntimeArn);
  
  // AgentCore endpoint - use the full ARN in the path
  const endpoint = `https://bedrock-agentcore.${region}.amazonaws.com`;
  // URL-encode the ARN for the path
  const encodedArn = encodeURIComponent(config.agentRuntimeArn);
  const path = `/runtimes/${encodedArn}/invocations`;
  const url = `${endpoint}${path}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Sign the request with AWS credentials
      const signer = new SignatureV4({
        credentials: defaultProvider(),
        region,
        service: 'bedrock-agentcore',
        sha256: Sha256,
      });

      const body = JSON.stringify(payload);
      
      const signedRequest = await signer.sign({
        method: 'POST',
        protocol: 'https:',
        hostname: `bedrock-agentcore.${region}.amazonaws.com`,
        path,
        query: {},
        headers: {
          'Content-Type': 'application/json',
          host: `bedrock-agentcore.${region}.amazonaws.com`,
        },
        body,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: signedRequest.headers as Record<string, string>,
        body,
      });

      // Check for rate limiting
      if (response.status === 429 || response.status === 503) {
        if (attempt < MAX_RETRIES - 1) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
          const delay = calculateBackoff(attempt) || retryAfter * 1000;
          console.warn('AgentCore throttled, retrying', { attempt, delay });
          await sleep(delay);
          continue;
        }
        return {
          success: false,
          error: 'AgentCore rate limit exceeded',
        };
      }

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `AgentCore error: ${response.status} - ${errorText.substring(0, 200)}`,
        };
      }

      const responseText = await response.text();

      // Parse the response
      let parsedResponse: { status: string; action_plan?: ActionPlan | MultiItemResponse; error?: string };
      try {
        parsedResponse = JSON.parse(responseText);
      } catch {
        // Try to extract Action Plan directly from response
        const actionPlan = parseActionPlanFromLLM(responseText);
        if (actionPlan) {
          return { success: true, actionPlan };
        }
        return {
          success: false,
          error: 'Failed to parse AgentCore response',
          rawResponse: responseText.substring(0, 500),
        };
      }

      if (parsedResponse.status === 'success' && parsedResponse.action_plan) {
        // Check if it's a multi-item response
        if (isMultiItemResponse(parsedResponse.action_plan)) {
          return {
            success: true,
            multiItemResponse: parsedResponse.action_plan as MultiItemResponse,
          };
        }
        return {
          success: true,
          actionPlan: parsedResponse.action_plan as ActionPlan,
        };
      }

      return {
        success: false,
        error: parsedResponse.error || 'Unknown error from AgentCore',
        rawResponse: responseText.substring(0, 500),
      };
    } catch (error: unknown) {
      if (attempt < MAX_RETRIES - 1) {
        const delay = calculateBackoff(attempt);
        console.warn('AgentCore invocation failed, retrying', { attempt, delay, error });
        await sleep(delay);
        continue;
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return {
    success: false,
    error: 'Max retries exceeded for AgentCore invocation',
  };
}

/**
 * Check if clarification is needed based on confidence
 * 
 * Validates: Requirements 7, 8
 */
export function shouldAskClarification(
  confidence: number,
  classification: string
): boolean {
  // Low confidence always needs clarification
  if (confidence < CONFIDENCE_THRESHOLDS.LOW) {
    return true;
  }

  // Medium confidence (0.7-0.85) - clarify for ambiguous classifications
  if (confidence < CONFIDENCE_THRESHOLDS.HIGH) {
    // For inbox, we can proceed without clarification (safe default)
    if (classification === 'inbox') {
      return false;
    }
    // For other classifications, ask for clarification
    return true;
  }

  // High confidence - proceed without clarification
  return false;
}

/**
 * Generate clarification prompt for user
 * 
 * Validates: Requirements 7.3, 38.1, 38.2
 */
export function generateClarificationPrompt(
  classification: string,
  confidence: number,
  alternativeClassifications?: string[]
): string {
  const options = alternativeClassifications || getAlternativeClassifications(classification);

  const lines = [
    "I'm not sure how to classify this. Is it:",
    '',
  ];

  const descriptions: Record<string, string> = {
    inbox: 'a quick note or observation',
    idea: 'a conceptual insight or observation',
    decision: 'a commitment you\'ve made',
    project: 'a multi-step initiative',
    task: 'something you need to do',
  };

  for (const opt of options) {
    lines.push(`• *${opt}* — ${descriptions[opt] || opt}`);
  }

  lines.push('');
  lines.push('Or reply `reclassify: <type>` to specify directly.');

  return lines.join('\n');
}

/**
 * Get alternative classifications for clarification
 */
function getAlternativeClassifications(primary: string): string[] {
  const all = ['inbox', 'idea', 'decision', 'project', 'task'];
  // Put primary first, then others
  return [primary, ...all.filter((c) => c !== primary)].slice(0, 4);
}

/**
 * Mock AgentCore client for testing
 * 
 * Validates: Testing strategy
 */
export class MockAgentCoreClient {
  private responses: Map<string, InvocationResult> = new Map();

  /**
   * Set a mock response for a given prompt pattern
   */
  setResponse(promptPattern: string, result: InvocationResult): void {
    this.responses.set(promptPattern, result);
  }

  /**
   * Invoke mock AgentCore
   */
  async invoke(payload: InvocationPayload): Promise<InvocationResult> {
    // Check for matching pattern
    for (const [pattern, result] of this.responses) {
      if (payload.prompt.includes(pattern)) {
        return result;
      }
    }

    // Default response - classify as inbox with medium confidence
    return {
      success: true,
      actionPlan: {
        classification: 'inbox',
        confidence: 0.75,
        reasoning: 'Mock classification',
        title: 'Mock title',
        content: payload.prompt,
        intent: 'capture',
        intent_confidence: 0.9,
        file_operations: [
          {
            operation: 'append',
            path: `00-inbox/${new Date().toISOString().split('T')[0]}.md`,
            content: `- ${payload.prompt}`,
          },
        ],
      },
    };
  }

  /**
   * Clear all mock responses
   */
  clear(): void {
    this.responses.clear();
  }
}
