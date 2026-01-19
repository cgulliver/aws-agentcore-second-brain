/**
 * Query Component Tests (Phase 2)
 * 
 * Validates: Requirements 53-57 (Semantic Query)
 */

import { describe, it, expect } from 'vitest';
import {
  extractDateFromPath,
  extractExcerpt,
  scoreFileRelevance,
  getTopRelevantFiles,
  formatFilesAsContext,
  type KnowledgeFile,
} from '../../src/components/knowledge-search';
import {
  processQuery,
  generateNoResultsResponse,
  formatCitationsForSlack,
  formatQuerySlackReply,
  validateResponseCitations,
  isLikelyQuery,
  buildQueryPrompt,
} from '../../src/components/query-handler';
import { validateActionPlan } from '../../src/components/action-plan';

describe('Knowledge Search', () => {
  describe('extractDateFromPath', () => {
    it('should extract date from inbox path', () => {
      expect(extractDateFromPath('00-inbox/2026-01-17.md')).toBe('2026-01-17');
    });

    it('should extract date from decision path', () => {
      expect(extractDateFromPath('20-decisions/2026-01-15-budget-approval.md')).toBe('2026-01-15');
    });

    it('should return undefined for paths without dates', () => {
      expect(extractDateFromPath('10-ideas/migration-strategy.md')).toBeUndefined();
    });
  });

  describe('extractExcerpt', () => {
    const content = `# Budget Decision

## Context
We need to decide on the Q1 budget allocation.

## Decision
Approved $50,000 for infrastructure upgrades.

## Rationale
This investment will improve system reliability.`;

    it('should extract relevant paragraph based on query', () => {
      const excerpt = extractExcerpt(content, 'budget allocation', 200);
      expect(excerpt).toContain('budget');
    });

    it('should truncate long excerpts', () => {
      const excerpt = extractExcerpt(content, 'decision', 50);
      expect(excerpt.length).toBeLessThanOrEqual(53); // 50 + '...'
    });

    it('should return start of content for no keyword matches', () => {
      const excerpt = extractExcerpt(content, 'xyz', 100);
      expect(excerpt).toContain('Budget Decision');
    });
  });

  describe('scoreFileRelevance', () => {
    const files: KnowledgeFile[] = [
      {
        path: '20-decisions/2026-01-15-budget-approval.md',
        content: 'Approved Q1 budget of $50,000 for infrastructure.',
        folder: '20-decisions',
        date: '2026-01-15',
      },
      {
        path: '10-ideas/cost-reduction.md',
        content: 'Ideas for reducing operational costs.',
        folder: '10-ideas',
      },
      {
        path: '00-inbox/2026-01-17.md',
        content: 'Random notes about meetings.',
        folder: '00-inbox',
        date: '2026-01-17',
      },
    ];

    it('should score files by relevance to query', () => {
      const scored = scoreFileRelevance(files, 'budget approval', 200);
      expect(scored[0].path).toBe('20-decisions/2026-01-15-budget-approval.md');
      expect(scored[0].relevanceScore).toBeGreaterThan(0);
    });

    it('should include excerpts in results', () => {
      const scored = scoreFileRelevance(files, 'budget', 200);
      expect(scored[0].excerpt).toBeDefined();
      expect(scored[0].excerpt.length).toBeGreaterThan(0);
    });

    it('should sort by relevance descending', () => {
      const scored = scoreFileRelevance(files, 'budget costs', 200);
      for (let i = 1; i < scored.length; i++) {
        expect(scored[i - 1].relevanceScore).toBeGreaterThanOrEqual(scored[i].relevanceScore);
      }
    });
  });

  describe('getTopRelevantFiles', () => {
    const files: KnowledgeFile[] = [
      { path: 'a.md', content: 'budget planning', folder: '10-ideas' },
      { path: 'b.md', content: 'budget approval', folder: '20-decisions' },
      { path: 'c.md', content: 'random content', folder: '00-inbox' },
    ];

    it('should return top k files', () => {
      const top = getTopRelevantFiles(files, 'budget', 2, 200);
      expect(top.length).toBeLessThanOrEqual(2);
    });

    it('should filter out zero-relevance files', () => {
      const top = getTopRelevantFiles(files, 'xyz', 5, 200);
      expect(top.every(f => f.relevanceScore > 0)).toBe(true);
    });
  });

  describe('formatFilesAsContext', () => {
    it('should format files with headers', () => {
      const files: KnowledgeFile[] = [
        { path: 'test.md', content: 'Test content', folder: '10-ideas', date: '2026-01-17' },
      ];
      const context = formatFilesAsContext(files);
      expect(context).toContain('FILE: test.md');
      expect(context).toContain('2026-01-17');
      expect(context).toContain('Test content');
    });

    it('should return message for empty files', () => {
      const context = formatFilesAsContext([]);
      expect(context).toContain('No knowledge files found');
    });
  });
});

describe('Query Handler', () => {
  describe('isLikelyQuery', () => {
    it('should detect question words', () => {
      expect(isLikelyQuery('What decisions have I made?')).toBe(true);
      expect(isLikelyQuery('When did I decide on the budget?')).toBe(true);
      expect(isLikelyQuery('How should I approach this?')).toBe(true);
    });

    it('should detect retrieval phrases', () => {
      expect(isLikelyQuery('Show me my ideas about migration')).toBe(true);
      expect(isLikelyQuery('Find all decisions about hiring')).toBe(true);
      expect(isLikelyQuery('List my projects')).toBe(true);
    });

    it('should detect question marks', () => {
      expect(isLikelyQuery('Budget status?')).toBe(true);
    });

    it('should not detect capture intent', () => {
      expect(isLikelyQuery('I need to review the budget')).toBe(false);
      expect(isLikelyQuery("I've decided to use TypeScript")).toBe(false);
      expect(isLikelyQuery('Meeting notes from today')).toBe(false);
    });
  });

  describe('generateNoResultsResponse', () => {
    it('should include the query in response', () => {
      const response = generateNoResultsResponse('budget decisions');
      expect(response).toContain('budget decisions');
    });

    it('should suggest capture', () => {
      const response = generateNoResultsResponse('test');
      expect(response.toLowerCase()).toContain('capture');
    });
  });

  describe('formatCitationsForSlack', () => {
    it('should format citations with bullet points', () => {
      const citations = formatCitationsForSlack([
        { path: 'test.md', relevanceScore: 0.8, excerpt: 'test', date: '2026-01-17' },
      ]);
      expect(citations).toContain('•');
      expect(citations).toContain('`test.md`');
      expect(citations).toContain('2026-01-17');
    });

    it('should return empty string for no citations', () => {
      expect(formatCitationsForSlack([])).toBe('');
    });
  });

  describe('formatQuerySlackReply', () => {
    it('should combine response and citations', () => {
      const reply = formatQuerySlackReply('Here is the answer.', [
        { path: 'source.md', relevanceScore: 0.9, excerpt: 'content' },
      ]);
      expect(reply).toContain('Here is the answer.');
      expect(reply).toContain('source.md');
    });
  });

  describe('validateResponseCitations', () => {
    it('should validate correct citations', () => {
      const result = validateResponseCitations(
        'Based on `test.md`, the budget is approved.',
        [{ path: 'test.md', relevanceScore: 0.9, excerpt: 'content' }]
      );
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn about uncited files', () => {
      const result = validateResponseCitations(
        'Based on `unknown.md`, something happened.',
        [{ path: 'test.md', relevanceScore: 0.9, excerpt: 'content' }]
      );
      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('processQuery', () => {
    const files: KnowledgeFile[] = [
      {
        path: '20-decisions/2026-01-15-budget.md',
        content: 'Approved Q1 budget of $50,000.',
        folder: '20-decisions',
        date: '2026-01-15',
      },
    ];

    it('should return cited files for relevant query', () => {
      const result = processQuery('budget decisions', files);
      expect(result.hasResults).toBe(true);
      expect(result.citedFiles.length).toBeGreaterThan(0);
    });

    it('should return no results for irrelevant query', () => {
      const result = processQuery('xyz123', files, { maxCitedFiles: 5, maxExcerptLength: 200, minRelevanceScore: 0.5 });
      expect(result.hasResults).toBe(false);
    });
  });

  describe('buildQueryPrompt', () => {
    it('should include query and context', () => {
      const prompt = buildQueryPrompt(
        'What is the budget?',
        'Budget is $50,000',
        [{ path: 'budget.md', relevanceScore: 0.9, excerpt: 'content' }]
      );
      expect(prompt).toContain('What is the budget?');
      expect(prompt).toContain('Budget is $50,000');
      expect(prompt).toContain('budget.md');
    });
  });
});

describe('Intent Classification', () => {
  describe('Action Plan with intent', () => {
    it('should validate capture intent action plan', () => {
      const plan = {
        intent: 'capture',
        intent_confidence: 0.95,
        classification: 'inbox',
        confidence: 0.9,
        reasoning: 'Test',
        title: 'Test',
        content: 'Test content',
        file_operations: [
          { operation: 'append', path: '00-inbox/2026-01-17.md', content: 'test' },
        ],
      };
      const result = validateActionPlan(plan);
      expect(result.valid).toBe(true);
    });

    it('should validate query intent action plan', () => {
      const plan = {
        intent: 'query',
        intent_confidence: 0.92,
        classification: null,
        confidence: 0,
        reasoning: 'Query detected',
        title: '',
        content: '',
        file_operations: [],
        query_response: 'Here is what I found...',
        cited_files: ['test.md'],
      };
      const result = validateActionPlan(plan);
      expect(result.valid).toBe(true);
    });

    it('should accept query intent without query_response (populated by worker)', () => {
      // query_response and cited_files are populated by the worker after searching
      // so they may not be present in the initial Action Plan from the LLM
      const plan = {
        intent: 'query',
        intent_confidence: 0.92,
        classification: null,
        confidence: 0,
        reasoning: 'Query detected',
        title: '',
        content: '',
        file_operations: [],
      };
      const result = validateActionPlan(plan);
      expect(result.valid).toBe(true);
    });

    it('should reject query intent with file_operations', () => {
      const plan = {
        intent: 'query',
        intent_confidence: 0.92,
        classification: null,
        confidence: 0,
        reasoning: 'Query detected',
        title: '',
        content: '',
        file_operations: [{ operation: 'create', path: 'test.md', content: 'test' }],
        query_response: 'Response',
        cited_files: ['test.md'],
      };
      const result = validateActionPlan(plan);
      expect(result.valid).toBe(false);
    });
  });
});
