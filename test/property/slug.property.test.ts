/**
 * Property-Based Tests: Slug Generation
 * 
 * Validates: Requirements 30.1-30.4 (Slug Generation)
 * 
 * Property 22: For any text input, the generateSlug function SHALL return
 * a slug that is:
 * - Lowercase
 * - Hyphen-separated
 * - 3-8 words
 * - ASCII characters only
 * - No date-like patterns
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateSlug } from '../../src/components/knowledge-store';

describe('Property 22: Slug Generation', () => {
  /**
   * Property: Slugs are always lowercase
   */
  it('should always produce lowercase slugs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (text) => {
          const slug = generateSlug(text);
          expect(slug).toBe(slug.toLowerCase());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Slugs use hyphens as separators
   */
  it('should use hyphens as word separators', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (text) => {
          const slug = generateSlug(text);
          // Should not contain spaces or underscores
          expect(slug).not.toContain(' ');
          expect(slug).not.toContain('_');
          // Should only contain lowercase letters, numbers, and hyphens
          expect(slug).toMatch(/^[a-z0-9-]+$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Slugs have 3-8 words (for non-trivial input)
   */
  it('should produce slugs with 3-8 words', () => {
    fc.assert(
      fc.property(
        // Generate strings with at least some alphabetic content
        fc.string({ minLength: 3, maxLength: 200 }).filter(s => /[a-zA-Z]{2,}/.test(s)),
        (text) => {
          const slug = generateSlug(text);
          const words = slug.split('-').filter(w => w.length > 0);
          
          expect(words.length).toBeGreaterThanOrEqual(3);
          expect(words.length).toBeLessThanOrEqual(8);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Slugs contain only ASCII characters
   */
  it('should contain only ASCII characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (text) => {
          const slug = generateSlug(text);
          // Check all characters are ASCII (0-127)
          for (const char of slug) {
            expect(char.charCodeAt(0)).toBeLessThan(128);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Slugs do not contain year-like patterns
   */
  it('should not contain year-like patterns', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2100 }),
        fc.string({ minLength: 5, maxLength: 50 }),
        (year, text) => {
          const input = `${text} ${year} more text`;
          const slug = generateSlug(input);
          
          // Should not contain 4-digit year
          expect(slug).not.toMatch(/\b\d{4}\b/);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Empty input produces fallback slug
   */
  it('should produce fallback for empty input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant('   '),
          fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 10 })
        ),
        (text) => {
          const slug = generateSlug(text);
          expect(slug).toBe('untitled-note');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Slugs are deterministic
   */
  it('should produce consistent results for same input', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (text) => {
          const slug1 = generateSlug(text);
          const slug2 = generateSlug(text);
          expect(slug1).toBe(slug2);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Special characters are removed
   */
  it('should remove special characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (text) => {
          const slug = generateSlug(text);
          // Should not contain special characters
          expect(slug).not.toMatch(/[!@#$%^&*()+=\[\]{};':"\\|,.<>\/?]/);
        }
      ),
      { numRuns: 100 }
    );
  });
});
