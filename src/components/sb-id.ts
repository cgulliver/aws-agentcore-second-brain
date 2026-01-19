/**
 * SB_ID Generator Component
 *
 * Generates canonical identifiers for Second Brain artifacts.
 * Format: sb-<7-char-hex> (e.g., "sb-a7f3c2d")
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { randomBytes } from 'crypto';

/**
 * SB_ID format pattern
 * Prefix "sb-" followed by exactly 7 lowercase hex characters
 */
const SB_ID_PATTERN = /^sb-[a-f0-9]{7}$/;

/**
 * Generate a canonical SB_ID
 *
 * Format: sb-<7-char-hex>
 * Uses crypto.randomBytes for secure randomness
 * Collision space: 16^7 = 268,435,456 unique IDs
 *
 * @returns Unique identifier (e.g., "sb-a7f3c2d")
 *
 * Validates: Requirements 1.1, 1.2
 */
export function generateSbId(): string {
  // Generate 4 random bytes (32 bits) and take first 7 hex chars
  const bytes = randomBytes(4);
  const hex = bytes.toString('hex').slice(0, 7);
  return `sb-${hex}`;
}

/**
 * Validate SB_ID format
 *
 * @param id - String to validate
 * @returns true if valid SB_ID format (sb-[a-f0-9]{7})
 *
 * Validates: Requirements 1.2
 */
export function isValidSbId(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  return SB_ID_PATTERN.test(id);
}

/**
 * Extract SB_ID from filename
 *
 * Parses filenames in format: YYYY-MM-DD__slug__sb-xxxxxxx.md
 *
 * @param filename - Filename to parse
 * @returns SB_ID or null if not found/invalid
 *
 * Validates: Requirements 3.3
 */
export function extractSbIdFromFilename(filename: string): string | null {
  if (typeof filename !== 'string') {
    return null;
  }

  // Match pattern: anything__anything__sb-xxxxxxx.md
  const match = filename.match(/__sb-([a-f0-9]{7})\.md$/);
  if (match) {
    return `sb-${match[1]}`;
  }

  return null;
}

/**
 * Extract SB_ID from content (front matter or inline)
 *
 * @param content - Markdown content to search
 * @returns SB_ID or null if not found
 */
export function extractSbIdFromContent(content: string): string | null {
  if (typeof content !== 'string') {
    return null;
  }

  // Look for id: sb-xxxxxxx in front matter
  const frontMatterMatch = content.match(/^---[\s\S]*?id:\s*(sb-[a-f0-9]{7})[\s\S]*?---/);
  if (frontMatterMatch) {
    return frontMatterMatch[1];
  }

  // Look for SB-ID: sb-xxxxxxx (OmniFocus format)
  const omniFocusMatch = content.match(/SB-ID:\s*(sb-[a-f0-9]{7})/);
  if (omniFocusMatch) {
    return omniFocusMatch[1];
  }

  return null;
}
