/**
 * Status Intent Detector Component
 * 
 * Detects status update intent from natural language messages.
 * Maps natural language terms to valid project status values.
 * 
 * Validates: Requirements 2.1, 2.3, 2.4
 */

import type { ProjectStatus, StatusUpdateDetails } from './action-plan';

// Natural language patterns for status updates
const STATUS_UPDATE_PATTERNS = [
  // "[project] is complete/done/finished"
  /^(.+?)\s+is\s+(complete|done|finished|on hold|paused|active|cancelled|canceled)$/i,
  // "Mark [project] as [status]"
  /^mark\s+(.+?)\s+as\s+(complete|done|finished|on hold|paused|active|cancelled|canceled)$/i,
  // "Pause/Hold [project]"
  /^(pause|hold)\s+(.+)$/i,
  // "Resume/Restart [project]"
  /^(resume|restart|reactivate)\s+(.+)$/i,
  // "Close/Cancel [project]"
  /^(close|cancel|drop)\s+(.+)$/i,
  // "Complete [project]"
  /^(complete|finish)\s+(.+)$/i,
  // "[project] project is [status]"
  /^(.+?)\s+project\s+is\s+(complete|done|finished|on hold|paused|active|cancelled|canceled)$/i,
];

// Mapping from natural language terms to ProjectStatus values
const STATUS_TERM_MAP: Record<string, ProjectStatus> = {
  // Complete status
  'complete': 'complete',
  'done': 'complete',
  'finished': 'complete',
  'finish': 'complete',
  
  // On-hold status
  'pause': 'on-hold',
  'paused': 'on-hold',
  'on hold': 'on-hold',
  'on-hold': 'on-hold',
  'hold': 'on-hold',
  
  // Active status
  'resume': 'active',
  'restart': 'active',
  'reactivate': 'active',
  'active': 'active',
  
  // Cancelled status
  'close': 'cancelled',
  'cancel': 'cancelled',
  'cancelled': 'cancelled',
  'canceled': 'cancelled',
  'drop': 'cancelled',
};

/**
 * Map natural language status term to ProjectStatus value
 * 
 * Validates: Requirements 2.4
 */
export function mapNaturalLanguageToStatus(term: string): ProjectStatus | null {
  const normalized = term.toLowerCase().trim();
  return STATUS_TERM_MAP[normalized] || null;
}

/**
 * Detect if a message is a status update request
 * 
 * Validates: Requirements 2.1
 */
export function detectStatusUpdateIntent(message: string): boolean {
  const trimmed = message.trim();
  
  for (const pattern of STATUS_UPDATE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract status update details from a message
 * 
 * Returns null if the message is not a status update request.
 * 
 * Validates: Requirements 2.1, 2.3
 */
export function extractStatusUpdate(message: string): StatusUpdateDetails | null {
  const trimmed = message.trim();
  
  // Try each pattern
  for (const pattern of STATUS_UPDATE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // Different patterns have different group positions
      let projectRef: string;
      let statusTerm: string;
      
      // Patterns like "pause [project]" have action first
      if (/^(pause|hold|resume|restart|reactivate|close|cancel|drop|complete|finish)\s+/i.test(trimmed)) {
        // Action is in group 1, project is in group 2
        statusTerm = match[1];
        projectRef = match[2];
      } else {
        // Project is in group 1, status is in group 2
        projectRef = match[1];
        statusTerm = match[2];
      }
      
      const targetStatus = mapNaturalLanguageToStatus(statusTerm);
      if (targetStatus && projectRef) {
        return {
          project_reference: projectRef.trim(),
          target_status: targetStatus,
        };
      }
    }
  }
  
  return null;
}

/**
 * Get all supported natural language terms for a given status
 */
export function getTermsForStatus(status: ProjectStatus): string[] {
  return Object.entries(STATUS_TERM_MAP)
    .filter(([_, value]) => value === status)
    .map(([key, _]) => key);
}

/**
 * Get all supported status update patterns (for documentation)
 */
export function getSupportedPatterns(): string[] {
  return [
    '[project] is complete/done/finished',
    '[project] is on hold/paused',
    '[project] is active',
    '[project] is cancelled/canceled',
    'Mark [project] as [status]',
    'Pause/Hold [project]',
    'Resume/Restart [project]',
    'Close/Cancel [project]',
    'Complete/Finish [project]',
  ];
}
