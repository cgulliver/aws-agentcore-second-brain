/**
 * Property-Based Tests for Front Matter Generation
 *
 * Validates: Requirements 2.1-2.5, 3.1-3.3, 5.1, 5.3, 5.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  generateFrontMatter,
  shouldHaveFrontMatter,
  generateFilename,
  generateWikilink,
  generateIdeaNote,
  generateDecisionNote,
  generateProjectPage,
  generateInboxEntry,
  FrontMatter,
} from '../../src/components/markdown-templates';
import { generateSbId, isValidSbId } from '../../src/components/sb-id';
import { isValidTag } from '../../src/components/tag-extractor';

describe('Front Matter Property Tests', () => {
  // Feature: front-matter-linked-thinking, Property 3: Front Matter Generation for Non-Inbox Types
  // For any idea/decision/project, markdown SHALL begin with front matter
  describe('Property 3: Front Matter Generation for Non-Inbox Types', () => {
    it('idea notes with sbId start with front matter', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 50 }),
          fc.string({ minLength: 10, maxLength: 200 }),
          (title, context) => {
            const sbId = generateSbId();
            const content = generateIdeaNote(
              { title, context, keyPoints: ['point 1'] },
              { sbId }
            );

            // Must start with ---
            expect(content.startsWith('---\n')).toBe(true);

            // Must contain required fields
            expect(content).toContain(`id: ${sbId}`);
            expect(content).toContain('type: idea');
            expect(content).toContain('title:');
            expect(content).toContain('created_at:');
            expect(content).toContain('tags:');

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('decision notes with sbId start with front matter', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 50 }),
          fc.string({ minLength: 10, maxLength: 200 }),
          (decision, rationale) => {
            const sbId = generateSbId();
            const content = generateDecisionNote(
              { decision, date: new Date(), rationale },
              { sbId }
            );

            expect(content.startsWith('---\n')).toBe(true);
            expect(content).toContain(`id: ${sbId}`);
            expect(content).toContain('type: decision');

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('project pages with sbId start with front matter', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 50 }),
          fc.string({ minLength: 10, maxLength: 200 }),
          (title, objective) => {
            const sbId = generateSbId();
            const content = generateProjectPage(
              { title, objective, status: 'active' },
              { sbId }
            );

            expect(content.startsWith('---\n')).toBe(true);
            expect(content).toContain(`id: ${sbId}`);
            expect(content).toContain('type: project');

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // Feature: front-matter-linked-thinking, Property 4: No Front Matter for Inbox Entries
  // For any inbox entry, markdown SHALL NOT contain front matter
  describe('Property 4: No Front Matter for Inbox Entries', () => {
    it('inbox entries never have front matter', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 200 }),
          (text) => {
            const content = generateInboxEntry(
              { text, timestamp: new Date() },
              { sbId: generateSbId() } // Even with sbId, inbox should not have front matter
            );

            // Must NOT start with ---
            expect(content.startsWith('---')).toBe(false);
            expect(content).not.toContain('id: sb-');
            expect(content).not.toContain('type: inbox');

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('shouldHaveFrontMatter returns false for inbox and task', () => {
      expect(shouldHaveFrontMatter('inbox')).toBe(false);
      expect(shouldHaveFrontMatter('task')).toBe(false);
    });

    it('shouldHaveFrontMatter returns true for idea, decision, project', () => {
      expect(shouldHaveFrontMatter('idea')).toBe(true);
      expect(shouldHaveFrontMatter('decision')).toBe(true);
      expect(shouldHaveFrontMatter('project')).toBe(true);
    });
  });

  // Feature: front-matter-linked-thinking, Property 5: Front Matter Position
  // For any markdown with front matter, it SHALL start at position 0
  describe('Property 5: Front Matter Position', () => {
    it('front matter always starts at character position 0', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('idea', 'decision', 'project') as fc.Arbitrary<'idea' | 'decision' | 'project'>,
          fc.string({ minLength: 5, maxLength: 50 }),
          fc.string({ minLength: 10, maxLength: 200 }),
          (type, title, content) => {
            const sbId = generateSbId();
            let markdown: string;

            if (type === 'idea') {
              markdown = generateIdeaNote(
                { title, context: content, keyPoints: ['point'] },
                { sbId }
              );
            } else if (type === 'decision') {
              markdown = generateDecisionNote(
                { decision: title, date: new Date(), rationale: content },
                { sbId }
              );
            } else {
              markdown = generateProjectPage(
                { title, objective: content, status: 'active' },
                { sbId }
              );
            }

            // Front matter must be at the very beginning
            expect(markdown.indexOf('---')).toBe(0);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // Feature: front-matter-linked-thinking, Property 6: Filename Convention
  // For any filename, it SHALL match YYYY-MM-DD__slug__sb-[a-f0-9]{7}.md
  describe('Property 6: Filename Convention', () => {
    it('generated filenames match the required pattern', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
          fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          (date, slug) => {
            const sbId = generateSbId();
            const dateStr = date.toISOString().slice(0, 10);
            const filename = generateFilename(dateStr, slug, sbId);

            // Must match pattern: YYYY-MM-DD__slug__sb-xxxxxxx.md
            const pattern = /^\d{4}-\d{2}-\d{2}__[a-z0-9-]+__sb-[a-f0-9]{7}\.md$/;
            expect(filename).toMatch(pattern);

            // Must contain the SB_ID
            expect(filename).toContain(sbId);

            // Must end with .md
            expect(filename.endsWith('.md')).toBe(true);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: front-matter-linked-thinking, Property 10: Wikilink Format with SB_ID
  // For any SB_ID, generateWikilink SHALL return [[sb-xxxxxxx]] or [[sb-xxxxxxx|text]]
  describe('Property 10: Wikilink Format with SB_ID', () => {
    it('wikilinks without display text match [[sb-xxxxxxx]]', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const sbId = generateSbId();
          const wikilink = generateWikilink(sbId);

          expect(wikilink).toBe(`[[${sbId}]]`);
          expect(wikilink).toMatch(/^\[\[sb-[a-f0-9]{7}\]\]$/);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('wikilinks with display text match [[sb-xxxxxxx|text]]', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('|') && !s.includes('[') && !s.includes(']')),
          (displayText) => {
            const sbId = generateSbId();
            const wikilink = generateWikilink(sbId, displayText);

            expect(wikilink).toBe(`[[${sbId}|${displayText}]]`);
            expect(wikilink).toMatch(/^\[\[sb-[a-f0-9]{7}\|.+\]\]$/);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('empty sbId returns empty string', () => {
      expect(generateWikilink('')).toBe('');
    });
  });

  describe('generateFrontMatter', () => {
    it('produces valid YAML structure', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('idea', 'decision', 'project') as fc.Arbitrary<'idea' | 'decision' | 'project'>,
          fc.string({ minLength: 5, maxLength: 50 }).filter((s) => !s.includes('"')),
          (type, title) => {
            const frontMatter: FrontMatter = {
              id: generateSbId(),
              type,
              title,
              created_at: new Date().toISOString(),
              tags: ['tag1', 'tag2'],
            };

            const yaml = generateFrontMatter(frontMatter);

            // Must start and end with ---
            expect(yaml.startsWith('---\n')).toBe(true);
            expect(yaml).toContain('\n---\n');

            // Must contain all required fields
            expect(yaml).toContain(`id: ${frontMatter.id}`);
            expect(yaml).toContain(`type: ${frontMatter.type}`);
            expect(yaml).toContain(`title: "${frontMatter.title}"`);
            expect(yaml).toContain(`created_at: ${frontMatter.created_at}`);
            expect(yaml).toContain('tags:');
            expect(yaml).toContain('  - tag1');
            expect(yaml).toContain('  - tag2');

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('handles empty tags array', () => {
      const frontMatter: FrontMatter = {
        id: generateSbId(),
        type: 'idea',
        title: 'Test',
        created_at: new Date().toISOString(),
        tags: [],
      };

      const yaml = generateFrontMatter(frontMatter);
      expect(yaml).toContain('tags: []');
    });

    it('escapes quotes in title', () => {
      const frontMatter: FrontMatter = {
        id: generateSbId(),
        type: 'idea',
        title: 'Test "quoted" title',
        created_at: new Date().toISOString(),
        tags: [],
      };

      const yaml = generateFrontMatter(frontMatter);
      expect(yaml).toContain('title: "Test \\"quoted\\" title"');
    });
  });

  describe('Front matter tags are valid', () => {
    it('extracted tags in front matter are valid format', () => {
      fc.assert(
        fc.property(
          // Use content that will produce meaningful tags
          fc.string({ minLength: 20, maxLength: 200 }).filter((s) => /[a-z]{4,}/.test(s.toLowerCase())),
          fc.string({ minLength: 5, maxLength: 50 }).filter((s) => /[a-z]{3,}/.test(s.toLowerCase())),
          (context, title) => {
            const sbId = generateSbId();
            const content = generateIdeaNote(
              { title, context, keyPoints: ['point 1', 'point 2'] },
              { sbId }
            );

            // Extract tags from the generated content using a simpler approach
            const tagMatches = content.matchAll(/^\s+-\s+([a-z0-9-]+)$/gm);
            for (const match of tagMatches) {
              const tag = match[1];
              if (tag && tag.length > 0) {
                expect(isValidTag(tag)).toBe(true);
              }
            }

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});


describe('Front Matter Parsing Property Tests', () => {
  // Feature: front-matter-linked-thinking, Property 13: Front Matter Parsing Round Trip
  // For any valid front matter, parseFrontMatter SHALL extract all fields correctly
  describe('Property 13: Front Matter Parsing Round Trip', () => {
    it('parseFrontMatter extracts all fields from generated front matter', async () => {
      const { parseFrontMatter } = await import('../../src/components/knowledge-search');
      
      fc.assert(
        fc.property(
          fc.constantFrom('idea', 'decision', 'project') as fc.Arbitrary<'idea' | 'decision' | 'project'>,
          fc.string({ minLength: 3, maxLength: 30 }).filter((s) => !s.includes('"') && !s.includes('\n')),
          fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{1,15}$/), { minLength: 0, maxLength: 4 }),
          (type, title, tags) => {
            const sbId = generateSbId();
            const createdAt = new Date().toISOString();
            
            const frontMatter: FrontMatter = {
              id: sbId,
              type,
              title,
              created_at: createdAt,
              tags,
            };
            
            const yaml = generateFrontMatter(frontMatter);
            const parsed = parseFrontMatter(yaml + '\n# Content here');
            
            expect(parsed).not.toBeNull();
            expect(parsed?.id).toBe(sbId);
            expect(parsed?.type).toBe(type);
            expect(parsed?.title).toBe(title);
            expect(parsed?.created_at).toBe(createdAt);
            expect(parsed?.tags).toEqual(tags);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // Feature: front-matter-linked-thinking, Property 14: Graceful Degradation Without Front Matter
  // For any content without front matter, parseFrontMatter SHALL return null
  describe('Property 14: Graceful Degradation Without Front Matter', () => {
    it('parseFrontMatter returns null for content without front matter', async () => {
      const { parseFrontMatter } = await import('../../src/components/knowledge-search');
      
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 500 }).filter((s) => !s.startsWith('---\n')),
          (content) => {
            const parsed = parseFrontMatter(content);
            expect(parsed).toBeNull();
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('parseFrontMatter returns null for malformed front matter', async () => {
      const { parseFrontMatter } = await import('../../src/components/knowledge-search');
      
      // Missing closing ---
      expect(parseFrontMatter('---\nid: sb-1234567\ntype: idea')).toBeNull();
      
      // Not at start of content
      expect(parseFrontMatter('\n---\nid: sb-1234567\n---\n')).toBeNull();
      
      // Empty front matter block
      expect(parseFrontMatter('---\n---\n')).toBeNull();
    });

    it('parseFrontMatter handles inbox entries gracefully', async () => {
      const { parseFrontMatter } = await import('../../src/components/knowledge-search');
      
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 200 }),
          (text) => {
            const content = generateInboxEntry(
              { text, timestamp: new Date() },
              {}
            );
            
            // Inbox entries don't have front matter
            const parsed = parseFrontMatter(content);
            expect(parsed).toBeNull();
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});


describe('Tag-Boosted Search Property Tests', () => {
  // Feature: front-matter-linked-thinking, Property 11: Tag Boost Existence
  // For any file with matching tags, score SHALL be higher than without tags
  describe('Property 11: Tag Boost Existence', () => {
    it('files with matching tags score higher than files without', async () => {
      const { scoreFileRelevance } = await import('../../src/components/knowledge-search');
      
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z]{4,10}$/),
          (keyword) => {
            const sbId = generateSbId();
            const content = `This is content about ${keyword} and other things.`;
            
            // File with matching tag
            const fileWithTag: any = {
              path: '10-ideas/test.md',
              content,
              folder: '10-ideas',
              frontMatter: {
                id: sbId,
                type: 'idea',
                title: 'Test',
                created_at: new Date().toISOString(),
                tags: [keyword],
              },
              sbId,
            };
            
            // File without tags (same content)
            const fileWithoutTag: any = {
              path: '10-ideas/test2.md',
              content,
              folder: '10-ideas',
            };
            
            const scored = scoreFileRelevance([fileWithTag, fileWithoutTag], keyword, 200);
            
            // File with matching tag should score higher
            const taggedScore = scored.find(f => f.path === '10-ideas/test.md')?.relevanceScore ?? 0;
            const untaggedScore = scored.find(f => f.path === '10-ideas/test2.md')?.relevanceScore ?? 0;
            
            expect(taggedScore).toBeGreaterThan(untaggedScore);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // Feature: front-matter-linked-thinking, Property 12: Tag Boost Magnitude
  // For any file with N matching tags, score boost SHALL be approximately N * 4 points
  describe('Property 12: Tag Boost Magnitude', () => {
    it('multiple matching tags provide cumulative boost', async () => {
      const { scoreFileRelevance } = await import('../../src/components/knowledge-search');
      
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[a-z]{4,8}$/), { minLength: 2, maxLength: 3 }),
          (keywords) => {
            const sbId = generateSbId();
            const query = keywords.join(' ');
            const content = `Content about ${keywords.join(' and ')}.`;
            
            // File with all tags
            const fileWithAllTags: any = {
              path: '10-ideas/all-tags.md',
              content,
              folder: '10-ideas',
              frontMatter: {
                id: sbId,
                type: 'idea',
                title: 'Test',
                created_at: new Date().toISOString(),
                tags: keywords,
              },
              sbId,
            };
            
            // File with one tag
            const fileWithOneTag: any = {
              path: '10-ideas/one-tag.md',
              content,
              folder: '10-ideas',
              frontMatter: {
                id: generateSbId(),
                type: 'idea',
                title: 'Test',
                created_at: new Date().toISOString(),
                tags: [keywords[0]],
              },
              sbId: generateSbId(),
            };
            
            const scored = scoreFileRelevance([fileWithAllTags, fileWithOneTag], query, 200);
            
            const allTagsScore = scored.find(f => f.path === '10-ideas/all-tags.md')?.relevanceScore ?? 0;
            const oneTagScore = scored.find(f => f.path === '10-ideas/one-tag.md')?.relevanceScore ?? 0;
            
            // More tags = higher score
            expect(allTagsScore).toBeGreaterThanOrEqual(oneTagScore);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});


describe('OmniFocus Task Notes Property Tests', () => {
  // Feature: front-matter-linked-thinking, Property 15: OmniFocus Task Notes Include SB_ID
  // For any task with sbId, notes SHALL include SB-ID line
  describe('Property 15: OmniFocus Task Notes Include SB_ID', () => {
    it('task notes include SB-ID when provided', async () => {
      const { formatTaskEmail } = await import('../../src/components/task-router');
      
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 50 }),
          fc.string({ minLength: 0, maxLength: 100 }),
          (title, context) => {
            const sbId = generateSbId();
            const email = formatTaskEmail(
              title,
              context,
              { userId: 'U123', channelId: 'C456', messageTs: '123' },
              { sbId }
            );
            
            // Must include SB-ID line
            expect(email.body).toContain(`SB-ID: ${sbId}`);
            // Must include SB-Source line
            expect(email.body).toContain('SB-Source: maildrop');
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('task notes include SB-Repo-Path when provided', async () => {
      const { formatTaskEmail } = await import('../../src/components/task-router');
      
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 50 }),
          fc.stringMatching(/^[a-z0-9-]+\/[a-z0-9-]+\.md$/),
          (title, repoPath) => {
            const sbId = generateSbId();
            const email = formatTaskEmail(
              title,
              '',
              { userId: 'U123', channelId: 'C456', messageTs: '123' },
              { sbId, repoPath }
            );
            
            expect(email.body).toContain(`SB-Repo-Path: ${repoPath}`);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('task notes without sbId do not include SB-ID line', async () => {
      const { formatTaskEmail } = await import('../../src/components/task-router');
      
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 50 }),
          (title) => {
            const email = formatTaskEmail(
              title,
              '',
              { userId: 'U123', channelId: 'C456', messageTs: '123' }
            );
            
            // Must NOT include SB-ID line
            expect(email.body).not.toContain('SB-ID:');
            expect(email.body).not.toContain('SB-Source:');
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});


describe('Front Matter Validation Property Tests', () => {
  // Feature: front-matter-linked-thinking, Property 16: Front Matter Validation
  // For any content with front matter, validation SHALL check all required fields
  describe('Property 16: Front Matter Validation', () => {
    it('valid front matter passes validation', async () => {
      const { parseFrontMatter } = await import('../../src/components/knowledge-search');
      
      fc.assert(
        fc.property(
          fc.constantFrom('idea', 'decision', 'project') as fc.Arbitrary<'idea' | 'decision' | 'project'>,
          fc.string({ minLength: 3, maxLength: 30 }).filter((s) => !s.includes('"') && !s.includes('\n')),
          (type, title) => {
            const sbId = generateSbId();
            const frontMatter: FrontMatter = {
              id: sbId,
              type,
              title,
              created_at: new Date().toISOString(),
              tags: ['tag1', 'tag2'],
            };
            
            const yaml = generateFrontMatter(frontMatter);
            const parsed = parseFrontMatter(yaml + '\n# Content');
            
            // Valid front matter should parse successfully
            expect(parsed).not.toBeNull();
            expect(parsed?.id).toMatch(/^sb-[a-f0-9]{7}$/);
            expect(parsed?.type).toBe(type);
            expect(parsed?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('SB_ID format is validated correctly', () => {
      // Valid SB_IDs
      expect(isValidSbId('sb-a7f3c2d')).toBe(true);
      expect(isValidSbId('sb-0000000')).toBe(true);
      expect(isValidSbId('sb-fffffff')).toBe(true);
      
      // Invalid SB_IDs
      expect(isValidSbId('sb-A7F3C2D')).toBe(false); // uppercase
      expect(isValidSbId('sb-a7f3c2')).toBe(false);  // too short
      expect(isValidSbId('sb-a7f3c2d1')).toBe(false); // too long
      expect(isValidSbId('a7f3c2d')).toBe(false);    // missing prefix
      expect(isValidSbId('SB-a7f3c2d')).toBe(false); // uppercase prefix
      expect(isValidSbId('')).toBe(false);           // empty
    });

    it('type field matches classification', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('idea', 'decision', 'project') as fc.Arbitrary<'idea' | 'decision' | 'project'>,
          (type) => {
            const sbId = generateSbId();
            const frontMatter: FrontMatter = {
              id: sbId,
              type,
              title: 'Test',
              created_at: new Date().toISOString(),
              tags: [],
            };
            
            const yaml = generateFrontMatter(frontMatter);
            
            // Type in YAML should match the input type
            expect(yaml).toContain(`type: ${type}`);
            
            return true;
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
