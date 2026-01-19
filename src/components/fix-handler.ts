/**
 * Fix Handler Component
 * 
 * Parses fix commands and applies corrections to previous entries.
 * 
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4
 */

import type { KnowledgeStoreConfig, CommitResult } from './knowledge-store';
import { readFile, writeFile, getLatestCommitId } from './knowledge-store';
import { findMostRecentReceipt, type Receipt } from './receipt-logger';
import { invokeAgentRuntime, type AgentCoreConfig, type InvocationPayload } from './agentcore-client';

// Fix command parsing result
export interface FixCommand {
  isFixCommand: boolean;
  instruction: string;
}

// Fix application result
export interface FixResult {
  success: boolean;
  commitId?: string;
  priorCommitId?: string;
  filesModified?: string[];
  error?: string;
}

/**
 * Parse fix command from message text
 * 
 * Validates: Requirements 10.1
 * 
 * Matches:
 * - "fix: instruction"
 * - "Fix: instruction"
 * - "FIX: instruction"
 * - "fix instruction" (without colon)
 */
export function parseFixCommand(text: string): FixCommand {
  if (!text || typeof text !== 'string') {
    return { isFixCommand: false, instruction: '' };
  }

  const trimmed = text.trim();
  
  // Match "fix:" prefix (case-insensitive)
  const fixWithColonMatch = trimmed.match(/^fix:\s*(.+)$/i);
  if (fixWithColonMatch) {
    return {
      isFixCommand: true,
      instruction: fixWithColonMatch[1].trim(),
    };
  }

  // Match "fix " prefix without colon (case-insensitive)
  const fixWithoutColonMatch = trimmed.match(/^fix\s+(.+)$/i);
  if (fixWithoutColonMatch) {
    return {
      isFixCommand: true,
      instruction: fixWithoutColonMatch[1].trim(),
    };
  }

  return { isFixCommand: false, instruction: '' };
}

/**
 * Check if a message is a fix command
 */
export function isFixCommand(text: string): boolean {
  return parseFixCommand(text).isFixCommand;
}

/**
 * Get the most recent receipt for a user that can be fixed
 * 
 * Validates: Requirements 10.2
 */
export async function getFixableReceipt(
  config: KnowledgeStoreConfig,
  userId: string
): Promise<Receipt | null> {
  // Find most recent non-fix receipt
  return findMostRecentReceipt(config, userId, true);
}

/**
 * Apply a fix to a previous entry
 * 
 * Validates: Requirements 10.3, 10.4
 */
export async function applyFix(
  knowledgeConfig: KnowledgeStoreConfig,
  agentConfig: AgentCoreConfig,
  priorReceipt: Receipt,
  instruction: string,
  systemPrompt: string
): Promise<FixResult> {
  try {
    // Get the file content that needs to be fixed
    if (priorReceipt.files.length === 0) {
      return {
        success: false,
        error: 'No files to fix in prior receipt',
      };
    }

    const filePath = priorReceipt.files[0];
    const currentContent = await readFile(knowledgeConfig, filePath);

    if (!currentContent) {
      return {
        success: false,
        error: `File not found: ${filePath}`,
      };
    }

    // Build prompt for AgentCore to apply the fix
    const fixPrompt = buildFixPrompt(
      currentContent,
      instruction,
      priorReceipt.classification,
      filePath
    );

    // Invoke AgentCore to get the corrected content
    const payload: InvocationPayload = {
      prompt: fixPrompt,
      system_prompt: systemPrompt,
      session_id: `fix-${priorReceipt.event_id}`,
    };

    const result = await invokeAgentRuntime(agentConfig, payload);

    if (!result.success || !result.actionPlan) {
      return {
        success: false,
        error: result.error || 'Failed to generate fix',
      };
    }

    // Apply the fix - write the corrected content
    const newContent = result.actionPlan.content;
    const commitMessage = `Fix: ${instruction.substring(0, 50)}${instruction.length > 50 ? '...' : ''}`;

    const parentCommitId = await getLatestCommitId(knowledgeConfig);
    const commitResult = await writeFile(
      knowledgeConfig,
      { path: filePath, content: newContent, mode: 'update' },
      commitMessage,
      parentCommitId
    );

    return {
      success: true,
      commitId: commitResult.commitId,
      priorCommitId: priorReceipt.commit_id || undefined,
      filesModified: [filePath],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Build the prompt for applying a fix
 */
function buildFixPrompt(
  currentContent: string,
  instruction: string,
  classification: string,
  filePath: string
): string {
  return `Apply this correction to the file content below.

FILE: ${filePath}
CURRENT CONTENT:
${currentContent}

CORRECTION: ${instruction}

Return ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  "intent": "capture",
  "intent_confidence": 1.0,
  "classification": "fix",
  "confidence": 1.0,
  "reasoning": "Applied user correction",
  "title": "Fix applied",
  "content": "<THE COMPLETE UPDATED FILE CONTENT HERE>",
  "file_operations": [{"operation": "update", "path": "${filePath}", "content": "<THE COMPLETE UPDATED FILE CONTENT HERE>"}]
}

The "content" field must contain the COMPLETE updated file with the correction applied.`;
}

/**
 * Validate that a fix can be applied
 */
export function canApplyFix(receipt: Receipt | null): { canFix: boolean; reason?: string } {
  if (!receipt) {
    return { canFix: false, reason: 'No recent entry found to fix' };
  }

  if (receipt.classification === 'fix') {
    return { canFix: false, reason: 'Cannot fix a fix entry' };
  }

  if (receipt.classification === 'clarify') {
    return { canFix: false, reason: 'Cannot fix a clarification' };
  }

  if (receipt.classification === 'task') {
    return { canFix: false, reason: 'Cannot fix a task - tasks are sent to OmniFocus' };
  }

  if (!receipt.commit_id) {
    return { canFix: false, reason: 'No commit to fix' };
  }

  if (receipt.files.length === 0) {
    return { canFix: false, reason: 'No files to fix' };
  }

  return { canFix: true };
}
