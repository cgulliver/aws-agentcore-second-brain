/**
 * Classification Types and Interfaces
 * 
 * Validates: Requirement 6 (Message Classification)
 */

/**
 * Valid classification types
 * Each message is classified as exactly one of these
 */
export type Classification = 'inbox' | 'idea' | 'decision' | 'project' | 'task';

/**
 * All valid classification values as an array
 * Useful for validation and iteration
 */
export const CLASSIFICATIONS: readonly Classification[] = [
  'inbox',
  'idea',
  'decision',
  'project',
  'task',
] as const;

/**
 * Type guard to check if a string is a valid Classification
 */
export function isValidClassification(value: string): value is Classification {
  return CLASSIFICATIONS.includes(value as Classification);
}

/**
 * Confidence thresholds for classification decisions
 * 
 * High (≥ 0.85): Proceed with side effects
 * Medium (0.70 - 0.84): Ask clarification or default to inbox
 * Low (< 0.70): Always ask clarification, no side effects
 */
export interface ConfidenceThresholds {
  high: number; // Default: 0.85
  low: number;  // Default: 0.70
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  high: 0.85,
  low: 0.70,
};

/**
 * Confidence level based on thresholds
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Determine confidence level from score and thresholds
 */
export function getConfidenceLevel(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS
): ConfidenceLevel {
  if (confidence >= thresholds.high) return 'high';
  if (confidence >= thresholds.low) return 'medium';
  return 'low';
}

/**
 * Classification result from AgentCore
 */
export interface ClassificationResult {
  classification: Classification;
  confidence: number; // 0.0 to 1.0
  reasoning: string;
  suggested_slug?: string; // For idea/decision/project
  suggested_title?: string; // For task
}

/**
 * Path mapping for each classification type
 */
export const CLASSIFICATION_PATHS: Record<Classification, string> = {
  inbox: '00-inbox',
  idea: '10-ideas',
  decision: '20-decisions',
  project: '30-projects',
  task: '', // Tasks don't have a path (sent to OmniFocus)
};
