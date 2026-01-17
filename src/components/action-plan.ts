/**
 * Action Plan Component
 * 
 * Defines the Action Plan schema and provides validation.
 * Parses LLM output to extract Action Plan JSON.
 * 
 * Validates: Requirements 42, 43
 */

import type { Classification } from '../types';

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

// Full Action Plan structure
export interface ActionPlan {
  classification: Classification;
  confidence: number;
  reasoning: string;
  title: string;
  content: string;
  suggested_slug?: string;
  file_operations: FileOperation[];
  task_details?: TaskDetails;
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

// Valid classifications
const VALID_CLASSIFICATIONS: Classification[] = [
  'inbox',
  'idea',
  'decision',
  'project',
  'task',
];

// Valid file path prefixes by classification
const VALID_PATH_PREFIXES: Record<Classification, string[]> = {
  inbox: ['00-inbox/'],
  idea: ['10-ideas/'],
  decision: ['20-decisions/'],
  project: ['30-projects/'],
  task: ['00-inbox/'], // Tasks may also log to inbox
};

/**
 * Validate Action Plan against schema
 * 
 * Validates: Requirements 43.1, 43.2
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

  // Required fields
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
    errors.push({ field: 'content', message: 'Content is required and must be a string' });
  }

  // File operations validation
  if (!Array.isArray(p.file_operations)) {
    errors.push({ field: 'file_operations', message: 'File operations must be an array' });
  } else {
    const classification = p.classification as Classification;
    const validPrefixes = VALID_PATH_PREFIXES[classification] || [];

    for (let i = 0; i < p.file_operations.length; i++) {
      const op = p.file_operations[i] as Record<string, unknown>;

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
  if (p.classification === 'task') {
    if (!p.task_details || typeof p.task_details !== 'object') {
      errors.push({
        field: 'task_details',
        message: 'Task details are required for task classification',
      });
    } else {
      const td = p.task_details as Record<string, unknown>;
      if (!td.title || typeof td.title !== 'string') {
        errors.push({
          field: 'task_details.title',
          message: 'Task title is required',
        });
      }
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
