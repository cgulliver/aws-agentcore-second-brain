/**
 * Action Plan Types and Interfaces
 * 
 * Validates: Requirement 42 (Action Plan Output Contract)
 */

import type { Classification } from './classification';

/**
 * File operation types
 */
export type FileOperationType = 'create' | 'append' | 'update';

/**
 * File operation in an Action Plan
 */
export interface FileOperation {
  path: string;
  operation: FileOperationType;
  content: string;
}

/**
 * OmniFocus email in an Action Plan
 */
export interface OmniFocusEmail {
  subject: string;
  body: string;
}

/**
 * Action Plan output from AgentCore
 * 
 * This is the structured output that AgentCore returns.
 * Lambda validates this against the schema before executing side effects.
 * 
 * Validates: Requirement 42 (Action Plan Output Contract)
 */
export interface ActionPlan {
  /** Classification type */
  classification: Classification;
  
  /** Confidence score (0.0 to 1.0) */
  confidence: number;
  
  /** Whether clarification is needed */
  needs_clarification: boolean;
  
  /** Clarification prompt (if needs_clarification is true) */
  clarification_prompt?: string;
  
  /** File operations to perform */
  file_operations: FileOperation[];
  
  /** Commit message for CodeCommit */
  commit_message: string;
  
  /** OmniFocus email (for task classification) */
  omnifocus_email?: OmniFocusEmail;
  
  /** Slack reply text */
  slack_reply_text: string;
}

/**
 * Action Plan validation result
 */
export interface ActionPlanValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Valid file operation types
 */
const VALID_FILE_OPERATIONS: readonly FileOperationType[] = ['create', 'append', 'update'];

/**
 * Valid classification values
 */
const VALID_CLASSIFICATIONS: readonly Classification[] = ['inbox', 'idea', 'decision', 'project', 'task'];

/**
 * Valid path prefixes for each classification
 */
const VALID_PATH_PREFIXES: Record<Classification, string> = {
  inbox: '00-inbox/',
  idea: '10-ideas/',
  decision: '20-decisions/',
  project: '30-projects/',
  task: '', // Tasks don't have file operations
};

/**
 * Validate an Action Plan against the schema
 * 
 * Validates: Requirement 43 (Action Plan Validation)
 */
export function validateActionPlan(plan: unknown): ActionPlanValidationResult {
  const errors: string[] = [];
  
  if (typeof plan !== 'object' || plan === null) {
    return { valid: false, errors: ['Action Plan must be an object'] };
  }
  
  const p = plan as Record<string, unknown>;
  
  // Required fields
  if (typeof p.classification !== 'string') {
    errors.push('classification must be a string');
  } else if (!VALID_CLASSIFICATIONS.includes(p.classification as Classification)) {
    errors.push(`classification must be one of: ${VALID_CLASSIFICATIONS.join(', ')}`);
  }
  
  if (typeof p.confidence !== 'number') {
    errors.push('confidence must be a number');
  } else if (p.confidence < 0 || p.confidence > 1) {
    errors.push('confidence must be between 0.0 and 1.0');
  }
  
  if (typeof p.needs_clarification !== 'boolean') {
    errors.push('needs_clarification must be a boolean');
  }
  
  if (p.needs_clarification === true && typeof p.clarification_prompt !== 'string') {
    errors.push('clarification_prompt is required when needs_clarification is true');
  }
  
  if (!Array.isArray(p.file_operations)) {
    errors.push('file_operations must be an array');
  } else {
    p.file_operations.forEach((op, index) => {
      if (typeof op !== 'object' || op === null) {
        errors.push(`file_operations[${index}] must be an object`);
        return;
      }
      
      const fileOp = op as Record<string, unknown>;
      
      if (typeof fileOp.path !== 'string') {
        errors.push(`file_operations[${index}].path must be a string`);
      } else {
        // Validate path matches classification taxonomy
        const classification = p.classification as Classification;
        const expectedPrefix = VALID_PATH_PREFIXES[classification];
        if (expectedPrefix && !fileOp.path.startsWith(expectedPrefix)) {
          errors.push(
            `file_operations[${index}].path must start with '${expectedPrefix}' for ${classification} classification`
          );
        }
      }
      
      if (typeof fileOp.operation !== 'string') {
        errors.push(`file_operations[${index}].operation must be a string`);
      } else if (!VALID_FILE_OPERATIONS.includes(fileOp.operation as FileOperationType)) {
        errors.push(
          `file_operations[${index}].operation must be one of: ${VALID_FILE_OPERATIONS.join(', ')}`
        );
      }
      
      if (typeof fileOp.content !== 'string') {
        errors.push(`file_operations[${index}].content must be a string`);
      }
    });
  }
  
  if (typeof p.commit_message !== 'string') {
    errors.push('commit_message must be a string');
  }
  
  // Optional omnifocus_email validation
  if (p.omnifocus_email !== undefined) {
    if (typeof p.omnifocus_email !== 'object' || p.omnifocus_email === null) {
      errors.push('omnifocus_email must be an object');
    } else {
      const email = p.omnifocus_email as Record<string, unknown>;
      if (typeof email.subject !== 'string') {
        errors.push('omnifocus_email.subject must be a string');
      }
      if (typeof email.body !== 'string') {
        errors.push('omnifocus_email.body must be a string');
      }
    }
  }
  
  if (typeof p.slack_reply_text !== 'string') {
    errors.push('slack_reply_text must be a string');
  }
  
  // Check for unexpected fields
  const expectedFields = [
    'classification',
    'confidence',
    'needs_clarification',
    'clarification_prompt',
    'file_operations',
    'commit_message',
    'omnifocus_email',
    'slack_reply_text',
  ];
  
  Object.keys(p).forEach((key) => {
    if (!expectedFields.includes(key)) {
      errors.push(`Unexpected field: ${key}`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parse Action Plan from LLM output
 * Extracts JSON from potentially wrapped response
 */
export function parseActionPlanFromLLM(llmOutput: string): ActionPlan | null {
  try {
    // Try direct parse first
    return JSON.parse(llmOutput) as ActionPlan;
  } catch {
    // Try to extract JSON from markdown code block
    const jsonMatch = llmOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim()) as ActionPlan;
      } catch {
        return null;
      }
    }
    
    // Try to find JSON object in the output
    const objectMatch = llmOutput.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as ActionPlan;
      } catch {
        return null;
      }
    }
    
    return null;
  }
}
