/**
 * Property-Based Tests: Classification to Path Mapping
 * 
 * Validates: Requirements 11.1-11.4, 29.3 (File Path Generation)
 * 
 * Property 13: For any classification with appropriate slug and date,
 * the generateFilePath function SHALL return a path that matches
 * the expected pattern for that classification.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateFilePath } from '../../src/components/knowledge-store';
import type { Classification } from '../../src/types';

describe('Property 13: Classification to Path Mapping', () => {
  // Arbitrary for valid slugs
  const slugArbitrary = fc.stringOf(
    fc.oneof(fc.char(), fc.constant('-')),
    { minLength: 3, maxLength: 30 }
  ).map(s => s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'test-slug');

  // Arbitrary for dates
  const dateArbitrary = fc.date({
    min: new Date('2020-01-01'),
    max: new Date('2030-12-31'),
  });

  /**
   * Property: Inbox paths follow 00-inbox/YYYY-MM-DD.md pattern
   */
  it('should generate inbox paths with date pattern', () => {
    fc.assert(
      fc.property(dateArbitrary, (date) => {
        const path = generateFilePath('inbox', undefined, date);
        
        expect(path).toMatch(/^00-inbox\/\d{4}-\d{2}-\d{2}\.md$/);
        expect(path).toContain(date.toISOString().split('T')[0]);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Idea paths follow 10-ideas/<slug>.md pattern
   */
  it('should generate idea paths with slug pattern', () => {
    fc.assert(
      fc.property(slugArbitrary, (slug) => {
        const path = generateFilePath('idea', slug);
        
        expect(path).toMatch(/^10-ideas\/[a-z0-9-]+\.md$/);
        expect(path).toContain(slug);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Decision paths follow 20-decisions/YYYY-MM-DD-<slug>.md pattern
   */
  it('should generate decision paths with date and slug pattern', () => {
    fc.assert(
      fc.property(slugArbitrary, dateArbitrary, (slug, date) => {
        const path = generateFilePath('decision', slug, date);
        
        expect(path).toMatch(/^20-decisions\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/);
        expect(path).toContain(date.toISOString().split('T')[0]);
        expect(path).toContain(slug);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Project paths follow 30-projects/<slug>.md pattern
   */
  it('should generate project paths with slug pattern', () => {
    fc.assert(
      fc.property(slugArbitrary, (slug) => {
        const path = generateFilePath('project', slug);
        
        expect(path).toMatch(/^30-projects\/[a-z0-9-]+\.md$/);
        expect(path).toContain(slug);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Task classification defaults to inbox path
   */
  it('should generate inbox path for task classification', () => {
    fc.assert(
      fc.property(dateArbitrary, (date) => {
        const path = generateFilePath('task', undefined, date);
        
        expect(path).toMatch(/^00-inbox\/\d{4}-\d{2}-\d{2}\.md$/);
      }),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Idea without slug throws error
   */
  it('should throw for idea without slug', () => {
    expect(() => generateFilePath('idea')).toThrow('Slug required');
  });

  /**
   * Property: Decision without slug throws error
   */
  it('should throw for decision without slug', () => {
    expect(() => generateFilePath('decision')).toThrow('Slug required');
  });

  /**
   * Property: Project without slug throws error
   */
  it('should throw for project without slug', () => {
    expect(() => generateFilePath('project')).toThrow('Slug required');
  });

  /**
   * Property: Path generation is deterministic
   */
  it('should produce consistent paths for same inputs', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('inbox' as Classification),
          fc.constant('idea' as Classification),
          fc.constant('decision' as Classification),
          fc.constant('project' as Classification)
        ),
        slugArbitrary,
        dateArbitrary,
        (classification, slug, date) => {
          const path1 = generateFilePath(classification, slug, date);
          const path2 = generateFilePath(classification, slug, date);
          expect(path1).toBe(path2);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: All paths end with .md extension
   */
  it('should always produce .md extension', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('inbox' as Classification),
          fc.constant('idea' as Classification),
          fc.constant('decision' as Classification),
          fc.constant('project' as Classification),
          fc.constant('task' as Classification)
        ),
        slugArbitrary,
        dateArbitrary,
        (classification, slug, date) => {
          const path = generateFilePath(classification, slug, date);
          expect(path).toMatch(/\.md$/);
        }
      ),
      { numRuns: 50 }
    );
  });
});
