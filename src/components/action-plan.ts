/**
 * Action Plan Component
 * 
 * Defines the Action Plan schema and provides validation.
 * Parses LLM output to extract Action Plan JSON.
 * 
 * Validates: Requirements 42, 43, 53 (Phase 2 Intent)
 */

import type { Classification } from '../types';

/**
 * Intent type for Phase 2 semantic query support and status updates
 */
export type Intent = 'capture' | 'query' | 'status_update';

/**
 * Valid project status values
 */
export type ProjectStatus = 'active' | 'on-hold' | 'complete' | 'cancelled';

/**
 * Valid project status values array for validation
 */
export const VALID_PROJECT_STATUSES: ProjectStatus[] = ['active', 'on-hold', 'complete', 'cancelled'];

// File operation in Action Plan
export interface FileOperation {
  operation: 'create' | 'append' | 'update';
  path: string;
  content: string;
}

// Task details for task classification
export interface TaskDetails {
  title: string;
  context?: string;
  due_date?: string;
}

// Linked project for task-project linking
export interface LinkedProject {
  sb_id: string;
  title: string;
  confidence: number;
}

// Status update details for status_update intent
export interface StatusUpdateDetails {
  project_reference: string;
  target_status: ProjectStatus;
}

// Matched project with current status (for status updates)
export interface MatchedProject {
  sb_id: string;
  title: string;
  current_status: ProjectStatus;
  path: string;
}

// Full Action Plan structure (Phase 2 with intent)
export interface ActionPlan {
  // Phase 2: Intent classification
  intent: Intent;
  intent_confidence: number;
  
  // Original fields
  classification: Classification | null;
  confidence: number;
  reasoning: string;
  title: string;
  content: string;
  suggested_slug?: string;
  file_operations: FileOperation[];
  task_details?: TaskDetails;
  
  // Phase 2: Query response fields
  query_response?: string;
  cited_files?: string[];
  
  // Task-project linking (optional, only for tasks)
  project_reference?: string | null;
  linked_project?: LinkedProject | null;
  project_candidates?: LinkedProject[];
  
  // Status update fields (for status_update intent)
  status_update?: StatusUpdateDetails;
  matched_project?: MatchedProject;
}

// Validation error
export interface ValidationError {
  field: string;
  message: string;
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// Valid classifications (including 'fix' for fix commands)
const VALID_CLASSIFICATIONS: string[] = [
  'inbox',
  'idea',
  'decision',
  'project',
  'task',
  'fix',
];

// Valid file path prefixes by classification
const VALID_PATH_PREFIXES: Record<string, string[]> = {
  inbox: ['00-inbox/'],
  idea: ['10-ideas/'],
  decision: ['20-decisions/'],
  project: ['30-projects/'],
  task: ['00-inbox/'], // Tasks may also log to inbox
  fix: ['00-inbox/', '10-ideas/', '20-decisions/', '30-projects/'], // Fix can update any file
};

/**
 * Validate Action Plan against schema
 * 
 * Validates: Requirements 43.1, 43.2, 53 (Phase 2 Intent)
 */
export function validateActionPlan(plan: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  // Check if plan is an object
  if (!plan || typeof plan !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'root', message: 'Action Plan must be an object' }],
    };
  }

  const p = plan as Record<string, unknown>;

  // Phase 2: Intent validation
  const validIntents: Intent[] = ['capture', 'query', 'status_update'];
  if (!p.intent) {
    // Default to capture for backward compatibility
    p.intent = 'capture';
  } else if (!validIntents.includes(p.intent as Intent)) {
    errors.push({
      field: 'intent',
      message: `Invalid intent: ${p.intent}. Must be one of: ${validIntents.join(', ')}`,
    });
  }

  if (p.intent_confidence === undefined || p.intent_confidence === null) {
    // Default to 1.0 for backward compatibility
    p.intent_confidence = 1.0;
  } else {
    const intentConfidence = Number(p.intent_confidence);
    if (isNaN(intentConfidence) || intentConfidence < 0 || intentConfidence > 1) {
      errors.push({
        field: 'intent_confidence',
        message: 'Intent confidence must be a number between 0 and 1',
      });
    }
  }

  const isQueryIntent = p.intent === 'query';
  const isStatusUpdateIntent = p.intent === 'status_update';

  // For query intent, validate query-specific fields
  // Note: query_response and cited_files are populated by the worker after searching,
  // so they may not be present in the initial Action Plan from the LLM
  if (isQueryIntent) {
    // query_response and cited_files are optional at validation time
    // They will be populated by the worker after knowledge base search
    if (Array.isArray(p.file_operations) && p.file_operations.length > 0) {
      errors.push({ field: 'file_operations', message: 'File operations must be empty for query intent' });
    }
    // Skip classification validation for query intent
    return { valid: errors.length === 0, errors };
  }

  // For status_update intent, validate status update fields
  if (isStatusUpdateIntent) {
    // status_update object is required
    if (!p.status_update || typeof p.status_update !== 'object') {
      errors.push({ field: 'status_update', message: 'status_update object is required for status_update intent' });
    } else {
      const su = p.status_update as Record<string, unknown>;
      // Validate project_reference
      if (!su.project_reference || typeof su.project_reference !== 'string' || su.project_reference.length === 0) {
        errors.push({ field: 'status_update.project_reference', message: 'project_reference is required and must be a non-empty string' });
      }
      // Validate target_status
      if (!su.target_status || typeof su.target_status !== 'string') {
        errors.push({ field: 'status_update.target_status', message: 'target_status is required' });
      } else if (!VALID_PROJECT_STATUSES.includes(su.target_status as ProjectStatus)) {
        errors.push({ 
          field: 'status_update.target_status', 
          message: `target_status must be one of: ${VALID_PROJECT_STATUSES.join(', ')}` 
        });
      }
    }
    
    // Validate matched_project if present (populated by worker after matching)
    if (p.matched_project !== undefined && p.matched_project !== null) {
      const mp = p.matched_project as Record<string, unknown>;
      if (typeof mp !== 'object') {
        errors.push({ field: 'matched_project', message: 'matched_project must be an object' });
      } else {
        // Validate sb_id format
        if (!mp.sb_id || typeof mp.sb_id !== 'string') {
          errors.push({ field: 'matched_project.sb_id', message: 'sb_id is required and must be a string' });
        } else if (!/^sb-[a-f0-9]{7}$/.test(mp.sb_id as string)) {
          errors.push({ field: 'matched_project.sb_id', message: 'sb_id must match format sb-[a-f0-9]{7}' });
        }
        // Validate title
        if (!mp.title || typeof mp.title !== 'string') {
          errors.push({ field: 'matched_project.title', message: 'title is required and must be a string' });
        }
        // Validate current_status
        if (mp.current_status !== undefined && mp.current_status !== null) {
          if (!VALID_PROJECT_STATUSES.includes(mp.current_status as ProjectStatus)) {
            errors.push({ 
              field: 'matched_project.current_status', 
              message: `current_status must be one of: ${VALID_PROJECT_STATUSES.join(', ')}` 
            });
          }
        }
        // Validate path
        if (!mp.path || typeof mp.path !== 'string') {
          errors.push({ field: 'matched_project.path', message: 'path is required and must be a string' });
        }
      }
    }
    
    // Skip classification validation for status_update intent
    return { valid: errors.length === 0, errors };
  }

  // Required fields for capture intent
  if (!p.classification) {
    errors.push({ field: 'classification', message: 'Classification is required' });
  } else if (!VALID_CLASSIFICATIONS.includes(p.classification as Classification)) {
    errors.push({
      field: 'classification',
      message: `Invalid classification: ${p.classification}. Must be one of: ${VALID_CLASSIFICATIONS.join(', ')}`,
    });
  }

  if (p.confidence === undefined || p.confidence === null) {
    errors.push({ field: 'confidence', message: 'Confidence is required' });
  } else {
    const confidence = Number(p.confidence);
    if (isNaN(confidence)) {
      errors.push({ field: 'confidence', message: 'Confidence must be a number' });
    } else if (confidence < 0 || confidence > 1) {
      errors.push({
        field: 'confidence',
        message: `Confidence must be between 0 and 1, got: ${confidence}`,
      });
    }
  }

  if (!p.reasoning || typeof p.reasoning !== 'string') {
    errors.push({ field: 'reasoning', message: 'Reasoning is required and must be a string' });
  }

  if (!p.title || typeof p.title !== 'string') {
    errors.push({ field: 'title', message: 'Title is required and must be a string' });
  }

  if (!p.content || typeof p.content !== 'string') {
    // For tasks, content can be derived from title if missing
    if (p.classification === 'task' && p.title && typeof p.title === 'string') {
      // Allow missing content for tasks - we'll use title
    } else {
      errors.push({ field: 'content', message: 'Content is required and must be a string' });
    }
  }

  // File operations validation
  // For tasks, file_operations can be empty or missing (tasks route to email, not files)
  const classification = p.classification as Classification;
  const fileOps = p.file_operations;
  
  if (classification === 'task') {
    // Tasks don't require file operations - they route to OmniFocus via email
    // Allow null, undefined, or empty array
    if (fileOps !== null && fileOps !== undefined && !Array.isArray(fileOps)) {
      errors.push({ field: 'file_operations', message: 'File operations must be an array or null for tasks' });
    }
  } else if (!Array.isArray(fileOps)) {
    errors.push({ field: 'file_operations', message: 'File operations must be an array' });
  } else {
    const validPrefixes = VALID_PATH_PREFIXES[classification] || [];

    for (let i = 0; i < fileOps.length; i++) {
      const op = fileOps[i] as Record<string, unknown>;

      if (!op.operation || !['create', 'append', 'update'].includes(op.operation as string)) {
        errors.push({
          field: `file_operations[${i}].operation`,
          message: 'Operation must be create, append, or update',
        });
      }

      if (!op.path || typeof op.path !== 'string') {
        errors.push({
          field: `file_operations[${i}].path`,
          message: 'Path is required and must be a string',
        });
      } else if (validPrefixes.length > 0) {
        const pathValid = validPrefixes.some((prefix) =>
          (op.path as string).startsWith(prefix)
        );
        if (!pathValid) {
          errors.push({
            field: `file_operations[${i}].path`,
            message: `Path must start with one of: ${validPrefixes.join(', ')} for ${classification} classification`,
          });
        }
      }

      if (!op.content || typeof op.content !== 'string') {
        errors.push({
          field: `file_operations[${i}].content`,
          message: 'Content is required and must be a string',
        });
      }
    }
  }

  // Task details validation (required for task classification)
  // If task_details is missing but we have a title, we can construct it
  if (p.classification === 'task') {
    if (!p.task_details || typeof p.task_details !== 'object') {
      // Allow missing task_details - we'll construct from title
      // This is a soft validation to handle LLM inconsistency
    } else {
      const td = p.task_details as Record<string, unknown>;
      if (!td.title || typeof td.title !== 'string') {
        // If task_details exists but has no title, that's an error
        errors.push({
          field: 'task_details.title',
          message: 'Task title is required when task_details is provided',
        });
      }
    }
  }

  // Task-project linking validation (optional fields)
  // Validate linked_project structure when present
  if (p.linked_project !== undefined && p.linked_project !== null) {
    const lp = p.linked_project as Record<string, unknown>;
    if (typeof lp !== 'object') {
      errors.push({ field: 'linked_project', message: 'linked_project must be an object' });
    } else {
      // Validate sb_id format
      if (!lp.sb_id || typeof lp.sb_id !== 'string') {
        errors.push({ field: 'linked_project.sb_id', message: 'sb_id is required and must be a string' });
      } else if (!/^sb-[a-f0-9]{7}$/.test(lp.sb_id as string)) {
        errors.push({ field: 'linked_project.sb_id', message: 'sb_id must match format sb-[a-f0-9]{7}' });
      }
      // Validate title
      if (!lp.title || typeof lp.title !== 'string') {
        errors.push({ field: 'linked_project.title', message: 'title is required and must be a string' });
      }
      // Validate confidence
      if (lp.confidence === undefined || lp.confidence === null) {
        errors.push({ field: 'linked_project.confidence', message: 'confidence is required' });
      } else {
        const conf = Number(lp.confidence);
        if (isNaN(conf) || conf < 0 || conf > 1) {
          errors.push({ field: 'linked_project.confidence', message: 'confidence must be between 0 and 1' });
        }
      }
    }
  }

  // Validate project_candidates array structure when present
  if (p.project_candidates !== undefined && p.project_candidates !== null) {
    if (!Array.isArray(p.project_candidates)) {
      errors.push({ field: 'project_candidates', message: 'project_candidates must be an array' });
    } else if (p.project_candidates.length > 3) {
      errors.push({ field: 'project_candidates', message: 'project_candidates must have at most 3 items' });
    } else {
      for (let i = 0; i < p.project_candidates.length; i++) {
        const cand = p.project_candidates[i] as Record<string, unknown>;
        if (!cand.sb_id || typeof cand.sb_id !== 'string') {
          errors.push({ field: `project_candidates[${i}].sb_id`, message: 'sb_id is required' });
        }
        if (!cand.title || typeof cand.title !== 'string') {
          errors.push({ field: `project_candidates[${i}].title`, message: 'title is required' });
        }
      }
    }
  }

  // Validate project_reference when present
  if (p.project_reference !== undefined && p.project_reference !== null) {
    if (typeof p.project_reference !== 'string' || p.project_reference.length === 0) {
      errors.push({ field: 'project_reference', message: 'project_reference must be a non-empty string when present' });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parse Action Plan from LLM response
 * 
 * Validates: Requirements 42.1
 */
export function parseActionPlanFromLLM(response: string): ActionPlan | null {
  // Try to find JSON in code blocks first
  const jsonBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim()) as ActionPlan;
    } catch {
      // Continue to other methods
    }
  }

  // Try to parse entire response as JSON
  try {
    return JSON.parse(response.trim()) as ActionPlan;
  } catch {
    // Continue to other methods
  }

  // Try to find JSON object in response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as ActionPlan;
    } catch {
      // Failed to parse
    }
  }

  return null;
}

/**
 * Create a default Action Plan for fallback scenarios
 */
export function createDefaultActionPlan(
  messageText: string,
  classification: Classification = 'inbox'
): ActionPlan {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toISOString().split('T')[1].split('.')[0];

  return {
    intent: 'capture',
    intent_confidence: 1.0,
    classification,
    confidence: 0.5,
    reasoning: 'Default classification due to processing error',
    title: 'Captured message',
    content: `- ${timeStr}: ${messageText}`,
    file_operations: [
      {
        operation: 'append',
        path: `00-inbox/${dateStr}.md`,
        content: `- ${timeStr}: ${messageText}`,
      },
    ],
  };
}

/**
 * Check if Action Plan requires clarification based on confidence
 */
export function requiresClarification(
  plan: ActionPlan,
  lowThreshold: number = 0.7
): boolean {
  return plan.confidence < lowThreshold;
}

/**
 * Check if Action Plan has high confidence
 */
export function hasHighConfidence(
  plan: ActionPlan,
  highThreshold: number = 0.85
): boolean {
  return plan.confidence >= highThreshold;
}
