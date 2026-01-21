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

// Linked item for cross-item linking (ideas, decisions, projects)
export interface LinkedItem {
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
  
  // Cross-item linking (optional, for ideas/decisions/projects/tasks)
  linked_items?: LinkedItem[];
  
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

/**
 * Validate Action Plan against schema
 * 
 * PHILOSOPHY: Trust the LLM. Only validate absolute essentials.
 * The LLM is smart - let it do the heavy lifting. We only check
 * that we have enough to proceed, not that everything is perfect.
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

  // Phase 2: Intent - default to capture if missing
  const validIntents: Intent[] = ['capture', 'query', 'status_update'];
  if (!p.intent) {
    p.intent = 'capture';
  } else if (!validIntents.includes(p.intent as Intent)) {
    // Be lenient - default to capture instead of failing
    p.intent = 'capture';
  }

  // Default intent_confidence if missing
  if (p.intent_confidence === undefined || p.intent_confidence === null) {
    p.intent_confidence = 1.0;
  }

  const isQueryIntent = p.intent === 'query';
  const isStatusUpdateIntent = p.intent === 'status_update';

  // For query intent - minimal validation
  if (isQueryIntent) {
    return { valid: true, errors: [] };
  }

  // For status_update intent - just need project reference and target status
  if (isStatusUpdateIntent) {
    if (!p.status_update || typeof p.status_update !== 'object') {
      errors.push({ field: 'status_update', message: 'status_update object is required for status_update intent' });
    } else {
      const su = p.status_update as Record<string, unknown>;
      if (!su.project_reference) {
        errors.push({ field: 'status_update.project_reference', message: 'project_reference is required' });
      }
      if (!su.target_status) {
        errors.push({ field: 'status_update.target_status', message: 'target_status is required' });
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // For capture intent - just need classification and title
  // Everything else can be derived or defaulted
  if (!p.classification) {
    errors.push({ field: 'classification', message: 'Classification is required' });
  } else if (!VALID_CLASSIFICATIONS.includes(p.classification as Classification)) {
    errors.push({
      field: 'classification',
      message: `Invalid classification: ${p.classification}. Must be one of: ${VALID_CLASSIFICATIONS.join(', ')}`,
    });
  }

  if (!p.title || typeof p.title !== 'string') {
    errors.push({ field: 'title', message: 'Title is required' });
  }

  // Default confidence if missing
  if (p.confidence === undefined || p.confidence === null) {
    p.confidence = 0.8;
  }

  // Default reasoning if missing
  if (!p.reasoning) {
    p.reasoning = 'Classified based on message content';
  }

  // Content can be derived from title if missing
  if (!p.content && p.title) {
    p.content = `# ${p.title}`;
  }

  // File operations are optional - worker can generate them
  // No validation needed - trust the LLM or let worker handle it

  // linked_items validation is minimal - just check it's an array if present
  if (p.linked_items !== undefined && p.linked_items !== null && !Array.isArray(p.linked_items)) {
    // Convert to array if it's a single object
    if (typeof p.linked_items === 'object') {
      p.linked_items = [p.linked_items];
    }
  }

  return { valid: errors.length === 0, errors };
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


// ============================================================================
// Multi-Item Response Support
// ============================================================================

/**
 * Multi-item response wrapper
 * Used when the Classifier detects multiple distinct items in a message
 */
export interface MultiItemResponse {
  items: ActionPlan[];
}

/**
 * Type guard to check if response is multi-item format
 * Returns true if response contains an `items` array with at least 2 elements
 */
export function isMultiItemResponse(
  response: unknown
): response is MultiItemResponse {
  if (!response || typeof response !== 'object') {
    return false;
  }
  const r = response as Record<string, unknown>;
  return Array.isArray(r.items) && r.items.length >= 2;
}

/**
 * Multi-item validation error with item index
 */
export interface MultiItemValidationError {
  index: number;  // -1 for top-level errors
  field: string;
  message: string;
}

/**
 * Multi-item validation result
 */
export interface MultiItemValidationResult {
  valid: boolean;
  errors: MultiItemValidationError[];
  itemResults: ValidationResult[];
}

/**
 * Validate a multi-item response
 * Checks structure and validates each Action Plan independently
 */
export function validateMultiItemResponse(
  response: MultiItemResponse
): MultiItemValidationResult {
  const errors: MultiItemValidationError[] = [];
  const itemResults: ValidationResult[] = [];

  // Check items is an array
  if (!Array.isArray(response.items)) {
    return {
      valid: false,
      errors: [{ index: -1, field: 'items', message: 'items must be an array' }],
      itemResults: [],
    };
  }

  // Check minimum 2 items
  if (response.items.length < 2) {
    return {
      valid: false,
      errors: [{ index: -1, field: 'items', message: 'items array must contain at least 2 items' }],
      itemResults: [],
    };
  }

  // Validate each item
  for (let i = 0; i < response.items.length; i++) {
    const itemValidation = validateActionPlan(response.items[i]);
    itemResults.push(itemValidation);
    
    if (!itemValidation.valid) {
      for (const error of itemValidation.errors) {
        errors.push({
          index: i,
          field: error.field,
          message: error.message,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    itemResults,
  };
}
