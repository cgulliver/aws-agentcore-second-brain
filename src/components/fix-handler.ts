/**
 * Fix Handler Component
 * 
 * Parses fix commands and applies corrections to previous entries.
 * Supports both content fixes and reclassification requests.
 * 
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4
 */

import type { KnowledgeStoreConfig, CommitResult } from './knowledge-store';
import { readFile, writeFile, getLatestCommitId, deleteFile } from './knowledge-store';
import { findMostRecentReceipt, type Receipt } from './receipt-logger';
import { invokeAgentRuntime, type AgentCoreConfig, type InvocationPayload } from './agentcore-client';
import { parseFrontMatter, searchKnowledgeBase, DEFAULT_SEARCH_CONFIG } from './knowledge-search';
import { generateWikilink } from './markdown-templates';
import { CodeCommitClient } from '@aws-sdk/client-codecommit';
import type { Classification } from '../types';

// Fix command parsing result
export interface FixCommand {
  isFixCommand: boolean;
  instruction: string;
}

// Reclassification request
export interface ReclassifyRequest {
  isReclassify: boolean;
  targetClassification: Classification | null;
}

// Fix application result
export interface FixResult {
  success: boolean;
  commitId?: string;
  priorCommitId?: string;
  filesModified?: string[];
  error?: string;
  // Reclassification results
  reclassified?: boolean;
  newClassification?: Classification;
  originalMessage?: string;
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
 * Detect if a fix instruction is requesting reclassification
 * 
 * Matches patterns like:
 * - "this should be a task"
 * - "make this a task"
 * - "this is a task"
 * - "reclassify as task"
 * - "should be task"
 */
export function detectReclassifyRequest(instruction: string): ReclassifyRequest {
  const text = instruction.toLowerCase().trim();
  
  // Valid classification targets
  const classifications: Classification[] = ['inbox', 'idea', 'decision', 'project', 'task'];
  
  // Patterns that indicate reclassification
  const patterns = [
    /(?:this\s+)?should\s+(?:be\s+)?(?:an?\s+)?(\w+)/i,
    /(?:this\s+)?is\s+(?:an?\s+)?(\w+)/i,
    /make\s+(?:this\s+)?(?:an?\s+)?(\w+)/i,
    /reclassify\s+(?:as\s+)?(?:an?\s+)?(\w+)/i,
    /change\s+(?:to\s+)?(?:an?\s+)?(\w+)/i,
    /convert\s+(?:to\s+)?(?:an?\s+)?(\w+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const target = match[1].toLowerCase();
      if (classifications.includes(target as Classification)) {
        return {
          isReclassify: true,
          targetClassification: target as Classification,
        };
      }
    }
  }
  
  return { isReclassify: false, targetClassification: null };
}

/**
 * Extract the original message content from a file
 * For inbox files, extracts the most recent entry
 * For other files, extracts the main content
 */
export function extractOriginalMessage(fileContent: string, filePath: string): string {
  // For inbox files, get the last entry (most recent)
  if (filePath.startsWith('00-inbox/')) {
    const lines = fileContent.split('\n');
    // Find the last line that starts with "- HH:MM:" pattern
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      const match = line.match(/^-\s*\d{1,2}:\d{2}:\s*(.+)$/);
      if (match) {
        return match[1].trim();
      }
    }
    // Fallback: return last non-empty line
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        return lines[i].trim();
      }
    }
  }
  
  // For idea/decision/project files, extract from content
  // Skip the title line and get the context
  const lines = fileContent.split('\n');
  const contentLines: string[] = [];
  let inContext = false;
  
  for (const line of lines) {
    if (line.startsWith('## Context') || line.startsWith('## Rationale') || line.startsWith('## Objective')) {
      inContext = true;
      continue;
    }
    if (inContext && line.startsWith('##')) {
      break;
    }
    if (inContext && line.trim()) {
      contentLines.push(line.trim());
    }
  }
  
  if (contentLines.length > 0) {
    return contentLines.join(' ');
  }
  
  // Fallback: return the title
  const titleMatch = fileContent.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1] : fileContent.substring(0, 200);
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
 * 
 * Note: findMostRecentReceipt already filters out non-fixable types,
 * but these checks serve as a safety net and provide clear error messages.
 */
export function canApplyFix(receipt: Receipt | null): { canFix: boolean; reason?: string } {
  if (!receipt) {
    return { canFix: false, reason: 'No recent fixable entry found. Only inbox, idea, decision, and project entries can be fixed.' };
  }

  // Non-fixable classification types
  const nonFixableTypes: Record<string, string> = {
    fix: 'Cannot fix a fix entry',
    clarify: 'Cannot fix a clarification',
    task: 'Cannot fix a task - tasks are sent to OmniFocus and not stored in the knowledge base',
    query: 'Cannot fix a query - queries do not create files',
    status_update: 'Cannot fix a status update',
    'multi-item': 'Cannot fix a multi-item entry - please fix individual items',
  };

  const nonFixableReason = nonFixableTypes[receipt.classification];
  if (nonFixableReason) {
    return { canFix: false, reason: nonFixableReason };
  }

  if (!receipt.commit_id) {
    return { canFix: false, reason: 'No commit to fix' };
  }

  if (receipt.files.length === 0) {
    return { canFix: false, reason: 'No files to fix' };
  }

  return { canFix: true };
}
