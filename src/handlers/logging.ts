/**
 * Structured Logging and PII Protection
 * 
 * Provides structured logging with PII redaction for observability.
 * 
 * Validates: Requirements 27.1-27.6
 */

// Log levels
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Log entry structure
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
}

// PII patterns to redact
const PII_PATTERNS = [
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone numbers (various formats)
  /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  // SSN
  /\d{3}-\d{2}-\d{4}/g,
  // Credit card numbers (basic pattern)
  /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/g,
];

// Fields that should always be redacted
const SENSITIVE_FIELDS = [
  'message_text',
  'text',
  'content',
  'body',
  'email',
  'password',
  'secret',
  'token',
  'api_key',
  'apiKey',
];

/**
 * Redact PII from a string
 * 
 * Validates: Requirement 27.6
 */
export function redactPII(value: string): string {
  if (!value || typeof value !== 'string') {
    return value;
  }

  let redacted = value;
  for (const pattern of PII_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

/**
 * Redact sensitive fields from an object
 */
export function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Check if field should be fully redacted
    if (SENSITIVE_FIELDS.some(f => lowerKey.includes(f.toLowerCase()))) {
      result[key] = '[REDACTED]';
      continue;
    }

    // Recursively handle nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactSensitiveFields(value as Record<string, unknown>);
      continue;
    }

    // Redact PII from strings
    if (typeof value === 'string') {
      result[key] = redactPII(value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * Create a structured log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> = {}
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: redactSensitiveFields(context),
  };
}

/**
 * Log a message with structured context
 * 
 * Validates: Requirements 27.1-27.5
 */
export function log(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> = {}
): void {
  const entry = createLogEntry(level, message, context);
  const output = JSON.stringify(entry);

  switch (level) {
    case 'debug':
      console.debug(output);
      break;
    case 'info':
      console.info(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'error':
      console.error(output);
      break;
  }
}

/**
 * Log event processing start
 * 
 * Validates: Requirement 27.1
 */
export function logEventStart(eventId: string, context: Record<string, unknown> = {}): void {
  log('info', 'Event processing started', {
    event_id: eventId,
    ...context,
  });
}

/**
 * Log classification result
 * 
 * Validates: Requirements 27.2, 27.3
 */
export function logClassification(
  eventId: string,
  classification: string,
  confidence: number
): void {
  log('info', 'Classification completed', {
    event_id: eventId,
    classification,
    confidence,
  });
}

/**
 * Log action outcome
 * 
 * Validates: Requirement 27.4
 */
export function logActionOutcome(
  eventId: string,
  action: string,
  success: boolean,
  details: Record<string, unknown> = {}
): void {
  log(success ? 'info' : 'warn', `Action ${action} ${success ? 'succeeded' : 'failed'}`, {
    event_id: eventId,
    action,
    success,
    ...details,
  });
}

/**
 * Log commit result
 * 
 * Validates: Requirement 27.5
 */
export function logCommit(eventId: string, commitId: string, files: string[]): void {
  log('info', 'Commit created', {
    event_id: eventId,
    commit_id: commitId,
    files,
  });
}

/**
 * Create a child logger with preset context
 */
export function createLogger(baseContext: Record<string, unknown>) {
  return {
    debug: (message: string, context: Record<string, unknown> = {}) =>
      log('debug', message, { ...baseContext, ...context }),
    info: (message: string, context: Record<string, unknown> = {}) =>
      log('info', message, { ...baseContext, ...context }),
    warn: (message: string, context: Record<string, unknown> = {}) =>
      log('warn', message, { ...baseContext, ...context }),
    error: (message: string, context: Record<string, unknown> = {}) =>
      log('error', message, { ...baseContext, ...context }),
  };
}
