/**
 * Property-Based Tests for Tag Extractor
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  extractTags,
  isValidTag,
  STOP_WORDS,
  GENERIC_TERMS,
  DEFAULT_TAG_CONFIG,
} from '../../src/components/tag-extractor';

describe('Tag Extractor Property Tests', () => {
  // Feature: front-matter-linked-thinking, Property 7: Tag Count Bounds
  // For any content with sufficient keywords, extractTags SHALL return 2-4 tags
  describe('Property 7: Tag Count Bounds', () => {
    it('returns between 0 and maxTags tags', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 500 }),
          (content) => {
            const tags = extractTags(content);
            return tags.length >= 0 && tags.length <= DEFAULT_TAG_CONFIG.maxTags;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns up to maxTags for content with many keywords', () => {
      // Content with many distinct meaningful words
      const richContent = `
        TypeScript programming language development software engineering
        architecture microservices kubernetes docker containers deployment
        database postgresql mongodb redis caching performance optimization
        security authentication authorization encryption protocols networking
      `;

      const tags = extractTags(richContent);
      expect(tags.length).toBeLessThanOrEqual(DEFAULT_TAG_CONFIG.maxTags);
      expect(tags.length).toBeGreaterThan(0);
    });

    it('returns fewer tags when content has limited keywords', () => {
      const limitedContent = 'typescript programming';
      const tags = extractTags(limitedContent);
      expect(tags.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array for empty content', () => {
      expect(extractTags('')).toEqual([]);
      expect(extractTags('   ')).toEqual([]);
    });

    it('returns empty array for very short content', () => {
      expect(extractTags('hi')).toEqual([]);
      expect(extractTags('test')).toEqual([]);
    });
  });

  // Feature: front-matter-linked-thinking, Property 8: Tag Format Compliance
  // For any tag, it SHALL be lowercase alphanumeric with hyphens only
  describe('Property 8: Tag Format Compliance', () => {
    it('all extracted tags match the required format', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 20, maxLength: 500 }),
          (content) => {
            const tags = extractTags(content);
            return tags.every((tag) => {
              // Must be lowercase
              if (tag !== tag.toLowerCase()) return false;
              // Must match pattern: alphanumeric with optional hyphens
              if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tag)) return false;
              // Must pass validation
              if (!isValidTag(tag)) return false;
              return true;
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tags do not contain special characters', () => {
      const contentWithSpecialChars = `
        C++ programming! @mentions #hashtags $money
        email@example.com https://url.com/path?query=value
        "quoted text" 'single quotes' (parentheses)
      `;

      const tags = extractTags(contentWithSpecialChars);
      for (const tag of tags) {
        expect(tag).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    });

    it('tags are within length bounds', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 20, maxLength: 1000 }),
          (content) => {
            const tags = extractTags(content);
            return tags.every((tag) => tag.length >= 1 && tag.length <= 30);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: front-matter-linked-thinking, Property 9: Tag Stop Word Exclusion
  // For any tag, it SHALL NOT be a stop word or generic term
  describe('Property 9: Tag Stop Word Exclusion', () => {
    it('extracted tags are never stop words', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 20, maxLength: 500 }),
          (content) => {
            const tags = extractTags(content);
            return tags.every((tag) => !STOP_WORDS.has(tag));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('extracted tags are never generic terms', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 20, maxLength: 500 }),
          (content) => {
            const tags = extractTags(content);
            return tags.every((tag) => !GENERIC_TERMS.has(tag));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('content with only stop words returns empty array', () => {
      const stopWordsOnly = 'the and or but in on at to for of with by from';
      expect(extractTags(stopWordsOnly)).toEqual([]);
    });

    it('content with only generic terms returns empty array', () => {
      const genericOnly = 'thing things stuff note notes idea ideas';
      expect(extractTags(genericOnly)).toEqual([]);
    });

    it('filters stop words from mixed content', () => {
      const mixedContent = 'the typescript programming and software development';
      const tags = extractTags(mixedContent);

      expect(tags).not.toContain('the');
      expect(tags).not.toContain('and');
      expect(tags.length).toBeGreaterThan(0);
    });
  });

  describe('isValidTag validation', () => {
    it('accepts valid tags', () => {
      expect(isValidTag('typescript')).toBe(true);
      expect(isValidTag('api-design')).toBe(true);
      expect(isValidTag('career-growth')).toBe(true);
      expect(isValidTag('a1b2c3')).toBe(true);
    });

    it('rejects invalid tags', () => {
      expect(isValidTag('')).toBe(false);
      expect(isValidTag('TypeScript')).toBe(false); // uppercase
      expect(isValidTag('api_design')).toBe(false); // underscore
      expect(isValidTag('api--design')).toBe(false); // double hyphen
      expect(isValidTag('-api')).toBe(false); // leading hyphen
      expect(isValidTag('api-')).toBe(false); // trailing hyphen
      expect(isValidTag('api design')).toBe(false); // space
    });

    it('rejects non-string inputs', () => {
      expect(isValidTag(null as unknown as string)).toBe(false);
      expect(isValidTag(undefined as unknown as string)).toBe(false);
      expect(isValidTag(123 as unknown as string)).toBe(false);
    });
  });

  describe('Title weighting', () => {
    it('title words appear more frequently in tag selection', () => {
      const content = 'This is about various programming topics and software development practices.';
      const title = 'TypeScript Architecture';

      const tagsWithTitle = extractTags(content, title);
      const tagsWithoutTitle = extractTags(content);

      // Title words should be more likely to appear in tags
      // At minimum, the results should be different
      expect(tagsWithTitle).not.toEqual(tagsWithoutTitle);
    });
  });

  describe('Edge cases', () => {
    it('handles non-string input gracefully', () => {
      expect(extractTags(null as unknown as string)).toEqual([]);
      expect(extractTags(undefined as unknown as string)).toEqual([]);
      expect(extractTags(123 as unknown as string)).toEqual([]);
    });

    it('handles markdown content', () => {
      const markdown = `
# Heading

This is **bold** and *italic* text.

- List item 1
- List item 2

\`\`\`typescript
const code = 'example';
\`\`\`

[Link text](https://example.com)
      `;

      const tags = extractTags(markdown);
      // Should extract meaningful words, not markdown syntax
      expect(tags).not.toContain('#');
      expect(tags).not.toContain('**');
      expect(tags).not.toContain('```');
    });

    it('handles URLs in content', () => {
      const contentWithUrls = `
        Check out https://typescript.org for TypeScript documentation.
        Also see http://example.com/path?query=value for more info.
      `;

      const tags = extractTags(contentWithUrls);
      // Should not include URL fragments as tags
      expect(tags).not.toContain('https');
      expect(tags).not.toContain('http');
      expect(tags).not.toContain('com');
      expect(tags).not.toContain('org');
    });
  });
});
