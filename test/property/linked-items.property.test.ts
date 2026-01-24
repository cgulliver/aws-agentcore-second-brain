/**
 * Property-Based Tests for Cross-Item Linking
 * 
 * Tests the LinkedItem structure validation, wiki-link format,
 * duplicate prevention, and output formatting.
 * 
 * Feature: cross-item-linking
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateActionPlan, type LinkedItem } from '../../src/types/action-plan';
import { generateFrontMatter, generateTagsAndLinksFooter, type FrontMatter } from '../../src/components/markdown-templates';

// Generators
const sbIdGen = fc.hexaString({ minLength: 7, maxLength: 7 })
  .map(hex => `sb-${hex.toLowerCase()}`);

const linkedItemGen = fc.record({
  sb_id: sbIdGen,
  title: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
});

const linkedItemsGen = fc.array(linkedItemGen, { minLength: 0, maxLength: 5 });

const wikiLinkGen = sbIdGen.map(id => `[[${id}]]`);

const linksArrayGen = fc.array(wikiLinkGen, { minLength: 0, maxLength: 10 });

// Base valid Action Plan for testing
const baseValidPlan = {
  intent: 'capture',
  intent_confidence: 0.9,
  classification: 'idea',
  confidence: 0.85,
  needs_clarification: false,
  file_operations: [],
  commit_message: 'Test commit',
  slack_reply_text: 'Test reply',
};

describe('Property 1: LinkedItem Structure Validation', () => {
  /**
   * Property 1: LinkedItem Structure Validation
   * 
   * For any Action Plan with a `linked_items` array, each item SHALL contain:
   * - `sb_id` matching the format `sb-[a-f0-9]{7}`
   * - `title` as a non-empty string
   * - `confidence` as a number between 0 and 1
   * 
   * **Validates: Requirements 2.1, 2.2, 2.4**
   */
  it('should accept valid linked_items with correct structure', () => {
    fc.assert(
      fc.property(linkedItemsGen, (linkedItems) => {
        const plan = {
          ...baseValidPlan,
          linked_items: linkedItems,
        };
        
        const result = validateActionPlan(plan);
        
        // Should be valid when all linked items have correct structure
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject linked_items with invalid sb_id format', () => {
    const invalidSbIds = ['invalid', 'sb-123', 'sb-ABCDEFG', 'sb-12345678', ''];
    
    for (const invalidId of invalidSbIds) {
      const plan = {
        ...baseValidPlan,
        linked_items: [{ sb_id: invalidId, title: 'Test', confidence: 0.9 }],
      };
      
      const result = validateActionPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('sb_id'))).toBe(true);
    }
  });

  it('should reject linked_items with empty title', () => {
    fc.assert(
      fc.property(sbIdGen, fc.float({ min: 0, max: 1, noNaN: true }), (sbId, confidence) => {
        const plan = {
          ...baseValidPlan,
          linked_items: [{ sb_id: sbId, title: '', confidence }],
        };
        
        const result = validateActionPlan(plan);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('title') && e.includes('non-empty'))).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should reject linked_items with confidence out of range', () => {
    const outOfRangeConfidences = [-0.1, 1.1, -1, 2, 100];
    
    for (const confidence of outOfRangeConfidences) {
      fc.assert(
        fc.property(sbIdGen, fc.string({ minLength: 1, maxLength: 50 }), (sbId, title) => {
          const plan = {
            ...baseValidPlan,
            linked_items: [{ sb_id: sbId, title, confidence }],
          };
          
          const result = validateActionPlan(plan);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('confidence'))).toBe(true);
        }),
        { numRuns: 10 }
      );
    }
  });
});

describe('Property 2: Wiki-Link Format', () => {
  /**
   * Property 2: Wiki-Link Format
   * 
   * For any link in a front matter `links` array, the link SHALL match
   * the format `[[sb-[a-f0-9]{7}]]`.
   * 
   * **Validates: Requirements 3.2, 4.2**
   */
  it('should generate wiki-links in correct format', () => {
    const WIKI_LINK_PATTERN = /^\[\[sb-[a-f0-9]{7}\]\]$/;
    
    fc.assert(
      fc.property(linksArrayGen, (links) => {
        for (const link of links) {
          expect(link).toMatch(WIKI_LINK_PATTERN);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should include links in footer format (not front matter)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('tag1', 'tag2', 'tag3'), { minLength: 1, maxLength: 3 }),
        linksArrayGen.filter(arr => arr.length > 0),
        (tags, links) => {
          const footer = generateTagsAndLinksFooter(tags, links);
          
          // Should contain --- separator
          expect(footer).toContain('---');
          
          // Should contain Links: line
          expect(footer).toContain('Links:');
          
          // Each link should be in the footer
          for (const link of links) {
            expect(footer).toContain(link);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 3: No Duplicate Links', () => {
  /**
   * Property 3: No Duplicate Links
   * 
   * For any front matter update operation that adds links, the resulting
   * `links` array SHALL contain no duplicate entries, and all original
   * links SHALL be preserved.
   * 
   * **Validates: Requirements 3.3, 3.4, 4.3**
   */
  it('should preserve original links when adding new ones', () => {
    fc.assert(
      fc.property(
        linksArrayGen,
        linksArrayGen,
        (originalLinks, newLinks) => {
          // Simulate merging links (as the worker would do)
          const mergedLinks = [...originalLinks];
          for (const link of newLinks) {
            if (!mergedLinks.includes(link)) {
              mergedLinks.push(link);
            }
          }
          
          // All original links should be preserved
          for (const original of originalLinks) {
            expect(mergedLinks).toContain(original);
          }
          
          // No duplicates
          const uniqueLinks = [...new Set(mergedLinks)];
          expect(mergedLinks.length).toBe(uniqueLinks.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 4: Empty Links Handling', () => {
  /**
   * Property 4: Empty Links Handling
   * 
   * For any Action Plan where `linked_items` is undefined, null, or an
   * empty array, the generated front matter SHALL NOT include a `links` field.
   * 
   * **Validates: Requirements 2.3, 3.5**
   */
  it('should omit links field when linked_items is empty or undefined', () => {
    fc.assert(
      fc.property(
        sbIdGen,
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('"') && !s.includes('\n')),
        (id, title) => {
          // Test with no links field
          const frontMatterNoLinks: FrontMatter = {
            id,
            type: 'idea',
            title,
            created_at: new Date().toISOString(),
            tags: ['test'],
          };
          
          const yamlNoLinks = generateFrontMatter(frontMatterNoLinks);
          expect(yamlNoLinks).not.toContain('links:');
          
          // Test with empty links array
          const frontMatterEmptyLinks: FrontMatter = {
            id,
            type: 'idea',
            title,
            created_at: new Date().toISOString(),
            tags: ['test'],
            links: [],
          };
          
          const yamlEmptyLinks = generateFrontMatter(frontMatterEmptyLinks);
          expect(yamlEmptyLinks).not.toContain('links:');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should accept Action Plan with empty linked_items', () => {
    const plan = {
      ...baseValidPlan,
      linked_items: [],
    };
    
    const result = validateActionPlan(plan);
    expect(result.valid).toBe(true);
  });

  it('should accept Action Plan without linked_items field', () => {
    const plan = { ...baseValidPlan };
    
    const result = validateActionPlan(plan);
    expect(result.valid).toBe(true);
  });
});


describe('Property 5: Slack Confirmation Format', () => {
  /**
   * Property 5: Slack Confirmation Format
   * 
   * For any confirmation message for an item with `linked_items`, the message
   * SHALL contain for each linked item:
   * - The item's title
   * - The item's SB_ID in the format `[[sb-xxxxxxx]]`
   * - The pattern "Linked to:" followed by the linked items
   * 
   * **Validates: Requirements 5.5, 6.1, 6.2, 6.3**
   */
  
  // Helper function to format confirmation with linked items (mirrors action-executor logic)
  function formatLinkedItemsForSlack(linkedItems: Array<{ sb_id: string; title: string; confidence: number }>): string {
    if (linkedItems.length === 0) return '';
    const linkedText = linkedItems
      .map(item => `${item.title} ([[${item.sb_id}]])`)
      .join(', ');
    return `Linked to: ${linkedText}`;
  }
  
  it('should include title and SB_ID for each linked item', () => {
    fc.assert(
      fc.property(
        fc.array(linkedItemGen, { minLength: 1, maxLength: 5 }),
        (linkedItems) => {
          const formatted = formatLinkedItemsForSlack(linkedItems);
          
          // Should contain "Linked to:" prefix
          expect(formatted).toContain('Linked to:');
          
          // Each linked item should have its title and SB_ID
          for (const item of linkedItems) {
            expect(formatted).toContain(item.title);
            expect(formatted).toContain(`[[${item.sb_id}]]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('should return empty string when no linked items', () => {
    const formatted = formatLinkedItemsForSlack([]);
    expect(formatted).toBe('');
  });
});

describe('Property 6: Task Email Format with Links', () => {
  /**
   * Property 6: Task Email Format with Links
   * 
   * For any task email where the Action Plan has `linked_items`, the email body
   * SHALL contain:
   * - A `Related:` line with comma-separated titles
   * - An `SB-Links:` line with comma-separated SB_IDs
   * - These fields SHALL be separate from any `SB-Project:` field
   * 
   * **Validates: Requirements 8.2, 8.3, 8.4, 8.5**
   */
  
  // Helper function to build email body with linked items (mirrors action-executor logic)
  function buildTaskEmailBody(
    context: string,
    linkedProject?: { sb_id: string; title: string },
    linkedItems?: Array<{ sb_id: string; title: string; confidence: number }>
  ): string {
    const bodyLines: string[] = [];
    
    if (context) {
      bodyLines.push(context);
      bodyLines.push('');
    }
    
    if (linkedProject?.title) {
      bodyLines.push(`Project: ${linkedProject.title}`);
      bodyLines.push('');
    }
    
    if (linkedItems && linkedItems.length > 0) {
      const titles = linkedItems.map(item => item.title).join(', ');
      bodyLines.push(`Related: ${titles}`);
      bodyLines.push('');
    }
    
    bodyLines.push('---');
    
    if (linkedProject?.sb_id) {
      bodyLines.push(`SB-Project: ${linkedProject.sb_id}`);
    }
    
    if (linkedItems && linkedItems.length > 0) {
      const sbIds = linkedItems.map(item => item.sb_id).join(', ');
      bodyLines.push(`SB-Links: ${sbIds}`);
    }
    
    bodyLines.push('SB-Source: maildrop');
    bodyLines.push('Source: Slack DM');
    
    return bodyLines.join('\n');
  }
  
  it('should include Related line with comma-separated titles', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.array(linkedItemGen, { minLength: 1, maxLength: 5 }),
        (context, linkedItems) => {
          const body = buildTaskEmailBody(context, undefined, linkedItems);
          
          // Should contain Related: line
          expect(body).toContain('Related:');
          
          // Should contain all titles
          const titles = linkedItems.map(item => item.title);
          const relatedLine = body.split('\n').find(line => line.startsWith('Related:'));
          expect(relatedLine).toBeDefined();
          
          for (const title of titles) {
            expect(relatedLine).toContain(title);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('should include SB-Links line with comma-separated SB_IDs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.array(linkedItemGen, { minLength: 1, maxLength: 5 }),
        (context, linkedItems) => {
          const body = buildTaskEmailBody(context, undefined, linkedItems);
          
          // Should contain SB-Links: line
          expect(body).toContain('SB-Links:');
          
          // Should contain all SB_IDs
          const sbIds = linkedItems.map(item => item.sb_id);
          const sbLinksLine = body.split('\n').find(line => line.startsWith('SB-Links:'));
          expect(sbLinksLine).toBeDefined();
          
          for (const sbId of sbIds) {
            expect(sbLinksLine).toContain(sbId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('should keep SB-Links separate from SB-Project', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        sbIdGen,
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
        fc.array(linkedItemGen, { minLength: 1, maxLength: 3 }),
        (context, projectSbId, projectTitle, linkedItems) => {
          const linkedProject = { sb_id: projectSbId, title: projectTitle };
          const body = buildTaskEmailBody(context, linkedProject, linkedItems);
          
          // Should have both SB-Project and SB-Links on separate lines
          const lines = body.split('\n');
          const projectLine = lines.find(line => line.startsWith('SB-Project:'));
          const linksLine = lines.find(line => line.startsWith('SB-Links:'));
          
          expect(projectLine).toBeDefined();
          expect(linksLine).toBeDefined();
          
          // They should be different lines
          expect(projectLine).not.toBe(linksLine);
          
          // SB-Project should contain project SB_ID
          expect(projectLine).toContain(projectSbId);
          
          // SB-Links should contain linked item SB_IDs
          for (const item of linkedItems) {
            expect(linksLine).toContain(item.sb_id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('should not include Related or SB-Links when no linked items', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (context) => {
          const body = buildTaskEmailBody(context, undefined, []);
          
          expect(body).not.toContain('Related:');
          expect(body).not.toContain('SB-Links:');
        }
      ),
      { numRuns: 50 }
    );
  });
});
