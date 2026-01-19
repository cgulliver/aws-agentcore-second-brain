/**
 * Property-Based Tests for SB_ID Generator
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  generateSbId,
  isValidSbId,
  extractSbIdFromFilename,
  extractSbIdFromContent,
} from '../../src/components/sb-id';

describe('SB_ID Generator Property Tests', () => {
  // Feature: front-matter-linked-thinking, Property 1: SB_ID Format Compliance
  // For any generated SB_ID, format SHALL match sb-[a-f0-9]{7}
  describe('Property 1: SB_ID Format Compliance', () => {
    it('generated SB_IDs always match the required format', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const sbId = generateSbId();

          // Must start with "sb-"
          expect(sbId.startsWith('sb-')).toBe(true);

          // Must be exactly 10 characters (sb- + 7 hex)
          expect(sbId.length).toBe(10);

          // Must match the full pattern
          expect(sbId).toMatch(/^sb-[a-f0-9]{7}$/);

          // Must pass validation
          expect(isValidSbId(sbId)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: front-matter-linked-thinking, Property 2: SB_ID Uniqueness
  // For any two distinct calls to generateSbId(), the returned values SHALL be different
  describe('Property 2: SB_ID Uniqueness', () => {
    it('generates unique IDs across multiple calls', () => {
      const ids = new Set<string>();
      const numIds = 1000;

      for (let i = 0; i < numIds; i++) {
        ids.add(generateSbId());
      }

      // All IDs should be unique (set size equals number of generations)
      expect(ids.size).toBe(numIds);
    });

    it('batch generation produces no duplicates', () => {
      fc.assert(
        fc.property(fc.integer({ min: 10, max: 100 }), (count) => {
          const ids = new Set<string>();
          for (let i = 0; i < count; i++) {
            ids.add(generateSbId());
          }
          return ids.size === count;
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('isValidSbId validation', () => {
    it('accepts valid SB_IDs', () => {
      fc.assert(
        fc.property(
          fc.hexaString({ minLength: 7, maxLength: 7 }),
          (hex) => {
            const sbId = `sb-${hex.toLowerCase()}`;
            return isValidSbId(sbId) === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects invalid prefixes', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 5 }).filter((s) => s !== 'sb-'),
          fc.hexaString({ minLength: 7, maxLength: 7 }),
          (prefix, hex) => {
            const invalid = `${prefix}${hex.toLowerCase()}`;
            return isValidSbId(invalid) === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects wrong length hex', () => {
      fc.assert(
        fc.property(
          fc.hexaString({ minLength: 1, maxLength: 20 }).filter((s) => s.length !== 7),
          (hex) => {
            const invalid = `sb-${hex.toLowerCase()}`;
            return isValidSbId(invalid) === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects non-hex characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 7, maxLength: 7 }).filter((s) => !/^[a-f0-9]+$/.test(s.toLowerCase())),
          (nonHex) => {
            const invalid = `sb-${nonHex}`;
            return isValidSbId(invalid) === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects non-string inputs', () => {
      expect(isValidSbId(null as unknown as string)).toBe(false);
      expect(isValidSbId(undefined as unknown as string)).toBe(false);
      expect(isValidSbId(123 as unknown as string)).toBe(false);
      expect(isValidSbId({} as unknown as string)).toBe(false);
    });
  });

  describe('extractSbIdFromFilename', () => {
    it('extracts SB_ID from valid filenames', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
          fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          fc.hexaString({ minLength: 7, maxLength: 7 }),
          (date, slug, hex) => {
            const dateStr = date.toISOString().slice(0, 10);
            const sbId = `sb-${hex.toLowerCase()}`;
            const filename = `${dateStr}__${slug}__${sbId}.md`;

            const extracted = extractSbIdFromFilename(filename);
            return extracted === sbId;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns null for filenames without SB_ID', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('__sb-')),
          (filename) => {
            return extractSbIdFromFilename(filename) === null;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns null for non-string inputs', () => {
      expect(extractSbIdFromFilename(null as unknown as string)).toBe(null);
      expect(extractSbIdFromFilename(undefined as unknown as string)).toBe(null);
      expect(extractSbIdFromFilename(123 as unknown as string)).toBe(null);
    });
  });

  describe('extractSbIdFromContent', () => {
    it('extracts SB_ID from front matter', () => {
      fc.assert(
        fc.property(
          fc.hexaString({ minLength: 7, maxLength: 7 }),
          fc.string({ minLength: 0, maxLength: 100 }),
          (hex, body) => {
            const sbId = `sb-${hex.toLowerCase()}`;
            const content = `---\nid: ${sbId}\ntype: decision\n---\n\n${body}`;

            const extracted = extractSbIdFromContent(content);
            return extracted === sbId;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('extracts SB_ID from OmniFocus format', () => {
      fc.assert(
        fc.property(
          fc.hexaString({ minLength: 7, maxLength: 7 }),
          fc.string({ minLength: 0, maxLength: 100 }),
          (hex, prefix) => {
            const sbId = `sb-${hex.toLowerCase()}`;
            const content = `${prefix}\nSB-ID: ${sbId}\nSB-Source: maildrop`;

            const extracted = extractSbIdFromContent(content);
            return extracted === sbId;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns null for content without SB_ID', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 200 }).filter((s) => !s.includes('sb-')),
          (content) => {
            return extractSbIdFromContent(content) === null;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
