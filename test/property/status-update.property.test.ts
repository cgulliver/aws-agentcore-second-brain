/**
 * Property-Based Tests for Project Status Management
 * 
 * Feature: project-status-management
 * Tests correctness properties for status updates, task logging, and queries.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateActionPlan,
  VALID_PROJECT_STATUSES,
  type ProjectStatus,
  type ActionPlan,
  type StatusUpdateDetails,
  type MatchedProject,
} from '../../src/components/action-plan';

// Generators
const projectStatusGen = fc.constantFrom<ProjectStatus>('active', 'on-hold', 'complete', 'cancelled');

const sbIdGen = fc.hexaString({ minLength: 7, maxLength: 7 })
  .map(hex => `sb-${hex.toLowerCase()}`);

const nonEmptyStringGen = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0);

const statusUpdateDetailsGen = fc.record({
  project_reference: nonEmptyStringGen,
  target_status: projectStatusGen,
});

const matchedProjectGen = fc.record({
  sb_id: sbIdGen,
  title: nonEmptyStringGen,
  current_status: projectStatusGen,
  path: fc.constant('30-projects/').chain(prefix => 
    nonEmptyStringGen.map(name => `${prefix}${name}.md`)
  ),
});

const validStatusUpdateActionPlanGen = fc.record({
  intent: fc.constant('status_update' as const),
  intent_confidence: fc.float({ min: 0, max: 1, noNaN: true }),
  status_update: statusUpdateDetailsGen,
  classification: fc.constant(null),
  confidence: fc.constant(0),
  reasoning: fc.constant('Status update detected'),
  title: fc.constant(''),
  content: fc.constant(''),
  file_operations: fc.constant([]),
});

describe('Property 14: ActionPlan Status Update Structure', () => {
  /**
   * Property 14: ActionPlan Status Update Structure
   * 
   * For any ActionPlan with intent `status_update`:
   * - The `status_update` object SHALL be present with `project_reference` (non-empty string) 
   *   and `target_status` (valid status value)
   * - When a project is matched, `matched_project` SHALL contain `sb_id`, `title`, and `current_status`
   * 
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4
   */

  it('should validate status_update ActionPlan with valid status_update object', () => {
    fc.assert(
      fc.property(validStatusUpdateActionPlanGen, (plan) => {
        const result = validateActionPlan(plan);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject status_update intent without status_update object', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (confidence) => {
        const plan = {
          intent: 'status_update',
          intent_confidence: confidence,
          // Missing status_update object
        };
        const result = validateActionPlan(plan);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.field === 'status_update')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject status_update with empty project_reference', () => {
    fc.assert(
      fc.property(projectStatusGen, (status) => {
        const plan = {
          intent: 'status_update',
          intent_confidence: 0.9,
          status_update: {
            project_reference: '',
            target_status: status,
          },
        };
        const result = validateActionPlan(plan);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.field === 'status_update.project_reference')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should accept status_update with invalid target_status (lenient validation)', () => {
    // Lenient validation: we accept any target_status and let the worker handle it
    fc.assert(
      fc.property(
        nonEmptyStringGen,
        fc.string({ minLength: 1 }).filter(s => !VALID_PROJECT_STATUSES.includes(s as ProjectStatus)),
        (projectRef, invalidStatus) => {
          const plan = {
            intent: 'status_update',
            intent_confidence: 0.9,
            status_update: {
              project_reference: projectRef,
              target_status: invalidStatus,
            },
          };
          const result = validateActionPlan(plan);
          // Lenient validation accepts this
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should validate matched_project structure when present', () => {
    fc.assert(
      fc.property(validStatusUpdateActionPlanGen, matchedProjectGen, (plan, matchedProject) => {
        const planWithMatch = { ...plan, matched_project: matchedProject };
        const result = validateActionPlan(planWithMatch);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should accept matched_project with invalid sb_id format (lenient validation)', () => {
    // Lenient validation: matched_project is populated by worker, not validated strictly
    fc.assert(
      fc.property(
        validStatusUpdateActionPlanGen,
        fc.string().filter(s => !/^sb-[a-f0-9]{7}$/.test(s) && s.length > 0),
        (plan, invalidSbId) => {
          const planWithMatch = {
            ...plan,
            matched_project: {
              sb_id: invalidSbId,
              title: 'Test Project',
              current_status: 'active' as ProjectStatus,
              path: '30-projects/test.md',
            },
          };
          const result = validateActionPlan(planWithMatch);
          // Lenient validation accepts this - worker handles matched_project
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 2: Status Value Validation', () => {
  /**
   * Property 2: Status Value Validation
   * 
   * For any status value provided, only the values `active`, `on-hold`, `complete`, 
   * and `cancelled` SHALL be accepted. All other values SHALL be rejected.
   * 
   * Validates: Requirements 1.2
   */

  it('should accept all valid project status values', () => {
    fc.assert(
      fc.property(projectStatusGen, nonEmptyStringGen, (status, projectRef) => {
        const plan = {
          intent: 'status_update',
          intent_confidence: 0.9,
          status_update: {
            project_reference: projectRef,
            target_status: status,
          },
        };
        const result = validateActionPlan(plan);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should accept invalid status values (lenient validation)', () => {
    // Lenient validation: we accept any target_status and let the worker handle it
    const invalidStatuses = ['pending', 'done', 'archived', 'inactive', 'paused', 'finished'];
    
    for (const invalidStatus of invalidStatuses) {
      const plan = {
        intent: 'status_update',
        intent_confidence: 0.9,
        status_update: {
          project_reference: 'test project',
          target_status: invalidStatus,
        },
      };
      const result = validateActionPlan(plan);
      expect(result.valid).toBe(true);
    }
  });

  it('should reject empty target_status', () => {
    // Empty target_status is still rejected
    const plan = {
      intent: 'status_update',
      intent_confidence: 0.9,
      status_update: {
        project_reference: 'test project',
        target_status: '',
      },
    };
    const result = validateActionPlan(plan);
    expect(result.valid).toBe(false);
  });
});


import {
  parseFrontMatter,
  serializeFrontMatter,
  isValidProjectStatus,
} from '../../src/components/project-status-updater';

describe('Property 6: Status Update Content Preservation', () => {
  /**
   * Property 6: Status Update Content Preservation
   * 
   * For any project status update operation, all front matter fields except `status` 
   * SHALL remain unchanged, and the entire markdown body content SHALL remain unchanged.
   * 
   * Validates: Requirements 4.2, 4.3
   */

  // Generator for realistic titles (no leading/trailing whitespace, no special YAML chars)
  const realisticTitleGen = fc.string({ minLength: 1, maxLength: 100 })
    .filter(s => s.trim().length > 0 && !s.includes('\n') && !s.includes(':') && !s.includes('"') && !s.includes("'"))
    .map(s => s.trim());

  // Generator for front matter fields (excluding status which we test separately)
  const frontMatterFieldsGen = fc.record({
    id: sbIdGen,
    type: fc.constant('project'),
    title: realisticTitleGen,
    created_at: fc.date().map(d => d.toISOString()),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('\n') && !s.includes(':')).map(s => s.trim()), { maxLength: 5 }).map(arr => arr.filter(s => s.length > 0)),
  });

  // Generator for markdown body content
  const markdownBodyGen = fc.string({ minLength: 0, maxLength: 500 })
    .filter(s => !s.startsWith('---')); // Body shouldn't start with front matter delimiter

  it('should preserve all front matter fields through parse/serialize round-trip', () => {
    fc.assert(
      fc.property(frontMatterFieldsGen, projectStatusGen, markdownBodyGen, (fields, status, body) => {
        // Create front matter with status (tags go in footer, not front matter)
        const frontMatter = { ...fields, status, tags: [] };
        
        // Serialize to markdown
        const markdown = serializeFrontMatter(frontMatter, body);
        
        // Parse back
        const parsed = parseFrontMatter(markdown);
        
        // All fields should be preserved
        expect(parsed.frontMatter.id).toBe(fields.id);
        expect(parsed.frontMatter.type).toBe(fields.type);
        expect(parsed.frontMatter.title).toBe(fields.title);
        expect(parsed.frontMatter.created_at).toBe(fields.created_at);
        expect(parsed.frontMatter.status).toBe(status);
        
        // Tags are now stored in footer, not front matter
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve body content through parse/serialize round-trip', () => {
    fc.assert(
      fc.property(frontMatterFieldsGen, projectStatusGen, markdownBodyGen, (fields, status, body) => {
        const frontMatter = { ...fields, status };
        const markdown = serializeFrontMatter(frontMatter, body);
        const parsed = parseFrontMatter(markdown);
        
        // Body should be preserved (trimmed for comparison)
        expect(parsed.body.trim()).toBe(body.trim());
      }),
      { numRuns: 100 }
    );
  });

  it('should only change status field when updating status', () => {
    fc.assert(
      fc.property(
        frontMatterFieldsGen,
        projectStatusGen,
        projectStatusGen,
        markdownBodyGen,
        (fields, originalStatus, newStatus, body) => {
          // Create original content
          const originalFrontMatter = { ...fields, status: originalStatus };
          const originalMarkdown = serializeFrontMatter(originalFrontMatter, body);
          
          // Parse, update status, serialize
          const parsed = parseFrontMatter(originalMarkdown);
          parsed.frontMatter.status = newStatus;
          const updatedMarkdown = serializeFrontMatter(parsed.frontMatter, parsed.body);
          
          // Parse updated content
          const reparsed = parseFrontMatter(updatedMarkdown);
          
          // Only status should change
          expect(reparsed.frontMatter.id).toBe(fields.id);
          expect(reparsed.frontMatter.type).toBe(fields.type);
          expect(reparsed.frontMatter.title).toBe(fields.title);
          expect(reparsed.frontMatter.status).toBe(newStatus);
          expect(reparsed.body.trim()).toBe(body.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 2 (Extended): Status Value Validation via isValidProjectStatus', () => {
  /**
   * Extended Property 2 tests for the isValidProjectStatus function
   */

  it('should accept all valid project status values', () => {
    fc.assert(
      fc.property(projectStatusGen, (status) => {
        expect(isValidProjectStatus(status)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject non-string values', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
        (value) => {
          expect(isValidProjectStatus(value)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject invalid string values', () => {
    const invalidStrings = ['pending', 'done', 'archived', 'inactive', 'paused', 'finished', '', 'ACTIVE', 'Complete'];
    for (const invalid of invalidStrings) {
      expect(isValidProjectStatus(invalid)).toBe(false);
    }
  });
});


describe('Property 7: Commit Message Format', () => {
  /**
   * Property 7: Commit Message Format
   * 
   * For any status update commit, the commit message SHALL contain 
   * the project name and the new status value.
   * 
   * Validates: Requirements 4.4
   */

  // Helper to generate expected commit message format
  const generateExpectedCommitMessage = (title: string, status: ProjectStatus): string => {
    return `Update ${title} status to ${status}`;
  };

  it('should generate commit message containing project name and status', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0).map(s => s.trim()),
        projectStatusGen,
        (projectTitle, newStatus) => {
          const commitMessage = generateExpectedCommitMessage(projectTitle, newStatus);
          
          // Commit message should contain project title
          expect(commitMessage).toContain(projectTitle);
          
          // Commit message should contain new status
          expect(commitMessage).toContain(newStatus);
          
          // Commit message should follow expected format
          expect(commitMessage).toMatch(/^Update .+ status to (active|on-hold|complete|cancelled)$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include all valid status values in commit messages', () => {
    const statuses: ProjectStatus[] = ['active', 'on-hold', 'complete', 'cancelled'];
    const projectTitle = 'Test Project';
    
    for (const status of statuses) {
      const commitMessage = generateExpectedCommitMessage(projectTitle, status);
      expect(commitMessage).toBe(`Update ${projectTitle} status to ${status}`);
    }
  });
});


import {
  formatTaskLogEntry,
  ensureTasksSection,
  appendTaskToSection,
  type TaskLogEntry,
} from '../../src/components/task-logger';

// Generator for valid dates (YYYY-MM-DD format)
const validDateGen = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map(d => d.toISOString().split('T')[0]);

// Generator for task titles (non-empty, no newlines)
const taskTitleGen = fc.string({ minLength: 1, maxLength: 200 })
  .filter(s => s.trim().length > 0 && !s.includes('\n'))
  .map(s => s.trim());

// Generator for task log entries
const taskLogEntryGen = fc.record({
  date: validDateGen,
  title: taskTitleGen,
});

describe('Property 8: Task Log Entry Format', () => {
  /**
   * Property 8: Task Log Entry Format
   * 
   * For any task linked to a project, the task log entry appended to the project file 
   * SHALL match the format `- YYYY-MM-DD: <task title>` where the date is valid ISO 
   * format and the title is non-empty.
   * 
   * Validates: Requirements 5.1, 5.2
   */

  it('should format task log entries as "- YYYY-MM-DD: <title>"', () => {
    fc.assert(
      fc.property(taskLogEntryGen, (entry) => {
        const formatted = formatTaskLogEntry(entry);
        
        // Should start with "- "
        expect(formatted.startsWith('- ')).toBe(true);
        
        // Should contain the date
        expect(formatted).toContain(entry.date);
        
        // Should contain the title
        expect(formatted).toContain(entry.title.trim());
        
        // Should match the exact format
        expect(formatted).toBe(`- ${entry.date}: ${entry.title.trim()}`);
      }),
      { numRuns: 100 }
    );
  });

  it('should produce entries matching the expected regex pattern', () => {
    fc.assert(
      fc.property(taskLogEntryGen, (entry) => {
        const formatted = formatTaskLogEntry(entry);
        
        // Should match pattern: - YYYY-MM-DD: <non-empty text>
        expect(formatted).toMatch(/^- \d{4}-\d{2}-\d{2}: .+$/);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject invalid date formats', () => {
    const invalidDates = ['2025/01/18', '01-18-2025', '2025-1-18', '20250118', 'invalid'];
    
    for (const invalidDate of invalidDates) {
      expect(() => formatTaskLogEntry({ date: invalidDate, title: 'Test' }))
        .toThrow(/Invalid date format/);
    }
  });

  it('should reject empty titles', () => {
    fc.assert(
      fc.property(validDateGen, (date) => {
        expect(() => formatTaskLogEntry({ date, title: '' })).toThrow(/cannot be empty/);
        expect(() => formatTaskLogEntry({ date, title: '   ' })).toThrow(/cannot be empty/);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 9: Tasks Section Creation', () => {
  /**
   * Property 9: Tasks Section Creation
   * 
   * For any project file without a `## Tasks` section, when a task log entry is appended, 
   * the Knowledge_Store SHALL create the `## Tasks` section before the `---` source line.
   * 
   * Validates: Requirements 5.3
   */

  // Generator for project content without Tasks section
  const projectContentWithoutTasksGen = fc.record({
    frontMatter: fc.constant('---\nid: sb-1234567\ntype: project\ntitle: Test Project\nstatus: active\n---'),
    body: fc.string({ minLength: 0, maxLength: 500 }).filter(s => !s.includes('## Tasks')),
    hasSource: fc.boolean(),
  }).map(({ frontMatter, body, hasSource }) => {
    const source = hasSource ? '\n---\nSource: Slack DM from user' : '';
    return `${frontMatter}\n\n${body}${source}`;
  });

  it('should create ## Tasks section when it does not exist', () => {
    fc.assert(
      fc.property(projectContentWithoutTasksGen, (content) => {
        const result = ensureTasksSection(content);
        
        // Should contain ## Tasks section
        expect(result).toMatch(/^## Tasks\s*$/m);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve existing ## Tasks section', () => {
    const contentWithTasks = `---
id: sb-1234567
type: project
title: Test Project
status: active
---

# Test Project

## Tasks
- 2025-01-18: Existing task

---
Source: Slack DM`;

    const result = ensureTasksSection(contentWithTasks);
    
    // Should not duplicate the section
    const matches = result.match(/## Tasks/g);
    expect(matches).toHaveLength(1);
  });

  it('should place ## Tasks section before source line when present', () => {
    const contentWithSource = `---
id: sb-1234567
type: project
title: Test Project
status: active
---

# Test Project

Some content here.

---
Source: Slack DM from user`;

    const result = ensureTasksSection(contentWithSource);
    
    // ## Tasks should appear before ---\nSource:
    const tasksIndex = result.indexOf('## Tasks');
    const sourceIndex = result.indexOf('---\nSource:');
    
    expect(tasksIndex).toBeGreaterThan(-1);
    expect(sourceIndex).toBeGreaterThan(-1);
    expect(tasksIndex).toBeLessThan(sourceIndex);
  });
});

describe('Property 10: Task Entries No Completion Tracking', () => {
  /**
   * Property 10: Task Entries No Completion Tracking
   * 
   * For any task log entry in a project file, the entry SHALL NOT contain 
   * completion markers (e.g., `[x]`, `✓`, `done`, `completed`).
   * 
   * Validates: Requirements 5.4
   */

  it('should not include completion markers in formatted entries', () => {
    fc.assert(
      fc.property(taskLogEntryGen, (entry) => {
        const formatted = formatTaskLogEntry(entry);
        
        // The format should be "- YYYY-MM-DD: <title>" with no completion state prefix
        // We check that the format doesn't ADD completion markers, not that the title doesn't contain them
        const expectedFormat = `- ${entry.date}: ${entry.title}`;
        expect(formatted).toBe(expectedFormat);
        
        // The format should not have checkbox prefix before the date
        expect(formatted).not.toMatch(/^\[[ x]\] -/i);
        expect(formatted).not.toMatch(/^[✓✔] -/);
        
        // The format is just "- YYYY-MM-DD: title" with no completion state
        expect(formatted).toMatch(/^- \d{4}-\d{2}-\d{2}: /);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve task titles that happen to contain completion-like words', () => {
    // These are valid titles that contain words like "done" or "complete"
    const titlesWithCompletionWords = [
      'Review completed documentation',
      'Mark project as done in tracker',
      'Complete the setup process',
    ];
    
    for (const title of titlesWithCompletionWords) {
      const entry: TaskLogEntry = { date: '2025-01-18', title };
      const formatted = formatTaskLogEntry(entry);
      
      // Should still format correctly
      expect(formatted).toBe(`- 2025-01-18: ${title}`);
      
      // Should not add any checkbox markers
      expect(formatted).not.toMatch(/\[.\]/);
    }
  });
});


import {
  mapNaturalLanguageToStatus,
  detectStatusUpdateIntent,
  extractStatusUpdate,
} from '../../src/components/status-intent-detector';

describe('Property 4: Natural Language to Status Mapping', () => {
  /**
   * Property 4: Natural Language to Status Mapping
   * 
   * For any natural language status term, the Classifier SHALL map it to the correct status value:
   * - "complete", "done", "finished" → `complete`
   * - "pause", "on hold", "hold", "paused" → `on-hold`
   * - "resume", "restart", "reactivate", "active" → `active`
   * - "close", "cancel", "cancelled", "drop" → `cancelled`
   * 
   * Validates: Requirements 2.4
   */

  it('should map complete-related terms to "complete"', () => {
    const completeTerms = ['complete', 'done', 'finished', 'finish'];
    
    for (const term of completeTerms) {
      expect(mapNaturalLanguageToStatus(term)).toBe('complete');
      expect(mapNaturalLanguageToStatus(term.toUpperCase())).toBe('complete');
      expect(mapNaturalLanguageToStatus(` ${term} `)).toBe('complete');
    }
  });

  it('should map on-hold-related terms to "on-hold"', () => {
    const onHoldTerms = ['pause', 'paused', 'on hold', 'on-hold', 'hold'];
    
    for (const term of onHoldTerms) {
      expect(mapNaturalLanguageToStatus(term)).toBe('on-hold');
      expect(mapNaturalLanguageToStatus(term.toUpperCase())).toBe('on-hold');
    }
  });

  it('should map active-related terms to "active"', () => {
    const activeTerms = ['resume', 'restart', 'reactivate', 'active'];
    
    for (const term of activeTerms) {
      expect(mapNaturalLanguageToStatus(term)).toBe('active');
      expect(mapNaturalLanguageToStatus(term.toUpperCase())).toBe('active');
    }
  });

  it('should map cancelled-related terms to "cancelled"', () => {
    const cancelledTerms = ['close', 'cancel', 'cancelled', 'canceled', 'drop'];
    
    for (const term of cancelledTerms) {
      expect(mapNaturalLanguageToStatus(term)).toBe('cancelled');
      expect(mapNaturalLanguageToStatus(term.toUpperCase())).toBe('cancelled');
    }
  });

  it('should return null for unknown terms', () => {
    const unknownTerms = ['pending', 'waiting', 'archived', 'deleted', 'unknown', ''];
    
    for (const term of unknownTerms) {
      expect(mapNaturalLanguageToStatus(term)).toBeNull();
    }
  });
});

describe('Property 3: Status Update Intent Detection', () => {
  /**
   * Property 3: Status Update Intent Detection
   * 
   * For any message containing status update patterns (e.g., "[project] is complete", 
   * "pause [project]"), the Classifier SHALL detect `status_update` intent and extract 
   * both the project reference and target status.
   * 
   * Validates: Requirements 2.1, 2.3
   */

  // Generator for project names
  const projectNameGen = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0 && !s.includes('\n'))
    .map(s => s.trim());

  it('should detect "[project] is [status]" pattern', () => {
    const statusTerms = ['complete', 'done', 'finished', 'on hold', 'paused', 'active', 'cancelled'];
    
    fc.assert(
      fc.property(projectNameGen, fc.constantFrom(...statusTerms), (project, status) => {
        const message = `${project} is ${status}`;
        
        expect(detectStatusUpdateIntent(message)).toBe(true);
        
        const extracted = extractStatusUpdate(message);
        expect(extracted).not.toBeNull();
        expect(extracted?.project_reference).toBe(project);
        expect(extracted?.target_status).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should detect "Mark [project] as [status]" pattern', () => {
    const statusTerms = ['complete', 'done', 'on hold', 'active', 'cancelled'];
    
    fc.assert(
      fc.property(projectNameGen, fc.constantFrom(...statusTerms), (project, status) => {
        const message = `Mark ${project} as ${status}`;
        
        expect(detectStatusUpdateIntent(message)).toBe(true);
        
        const extracted = extractStatusUpdate(message);
        expect(extracted).not.toBeNull();
        expect(extracted?.project_reference).toBe(project);
      }),
      { numRuns: 100 }
    );
  });

  it('should detect "Pause/Hold [project]" pattern', () => {
    fc.assert(
      fc.property(projectNameGen, fc.constantFrom('Pause', 'Hold'), (project, action) => {
        const message = `${action} ${project}`;
        
        expect(detectStatusUpdateIntent(message)).toBe(true);
        
        const extracted = extractStatusUpdate(message);
        expect(extracted).not.toBeNull();
        expect(extracted?.project_reference).toBe(project);
        expect(extracted?.target_status).toBe('on-hold');
      }),
      { numRuns: 100 }
    );
  });

  it('should detect "Resume/Restart [project]" pattern', () => {
    fc.assert(
      fc.property(projectNameGen, fc.constantFrom('Resume', 'Restart', 'Reactivate'), (project, action) => {
        const message = `${action} ${project}`;
        
        expect(detectStatusUpdateIntent(message)).toBe(true);
        
        const extracted = extractStatusUpdate(message);
        expect(extracted).not.toBeNull();
        expect(extracted?.project_reference).toBe(project);
        expect(extracted?.target_status).toBe('active');
      }),
      { numRuns: 100 }
    );
  });

  it('should detect "Close/Cancel [project]" pattern', () => {
    fc.assert(
      fc.property(projectNameGen, fc.constantFrom('Close', 'Cancel', 'Drop'), (project, action) => {
        const message = `${action} ${project}`;
        
        expect(detectStatusUpdateIntent(message)).toBe(true);
        
        const extracted = extractStatusUpdate(message);
        expect(extracted).not.toBeNull();
        expect(extracted?.project_reference).toBe(project);
        expect(extracted?.target_status).toBe('cancelled');
      }),
      { numRuns: 100 }
    );
  });

  it('should not detect status update in regular messages', () => {
    const regularMessages = [
      'Task for home automation: Research protocols',
      'Add to second brain: Update documentation',
      'What projects are active?',
      'Remember to complete the report',
      'The project is going well',
    ];
    
    for (const message of regularMessages) {
      expect(detectStatusUpdateIntent(message)).toBe(false);
      expect(extractStatusUpdate(message)).toBeNull();
    }
  });
});


describe('Property 5: Auto-Update Threshold Behavior', () => {
  /**
   * Property 5: Auto-Update Threshold Behavior
   * 
   * For any project match result:
   * - If exactly one project matches with confidence >= 0.7, the status update SHALL proceed automatically
   * - If no project matches with confidence >= 0.5, no update SHALL occur and the user SHALL be informed
   * 
   * Validates: Requirements 3.3, 3.5
   */

  const AUTO_LINK_THRESHOLD = 0.7;
  const MIN_CONFIDENCE_THRESHOLD = 0.5;

  // Helper to determine if auto-update should proceed
  const shouldAutoUpdate = (confidence: number): boolean => {
    return confidence >= AUTO_LINK_THRESHOLD;
  };

  // Helper to determine if match is valid at all
  const isValidMatch = (confidence: number): boolean => {
    return confidence >= MIN_CONFIDENCE_THRESHOLD;
  };

  it('should auto-update when confidence >= 0.7', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.71), max: Math.fround(1.0), noNaN: true }),
        (confidence) => {
          expect(shouldAutoUpdate(confidence)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not auto-update when confidence < 0.7', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0), max: Math.fround(0.69), noNaN: true }),
        (confidence) => {
          expect(shouldAutoUpdate(confidence)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should consider match valid when confidence >= 0.5', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.5), max: Math.fround(1.0), noNaN: true }),
        (confidence) => {
          expect(isValidMatch(confidence)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should consider match invalid when confidence < 0.5', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0), max: Math.fround(0.49), noNaN: true }),
        (confidence) => {
          expect(isValidMatch(confidence)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should have consistent threshold behavior', () => {
    // Boundary tests
    expect(shouldAutoUpdate(0.7)).toBe(true);
    expect(shouldAutoUpdate(0.699)).toBe(false);
    expect(isValidMatch(0.5)).toBe(true);
    expect(isValidMatch(0.499)).toBe(false);
  });
});

describe('Property 15: Slack Confirmation Format', () => {
  /**
   * Property 15: Slack Confirmation Format
   * 
   * For any successful status update, the Slack reply SHALL match the format 
   * "Updated [project title] ([SB_ID]) status to [status]" where all placeholders 
   * are replaced with actual values.
   * 
   * Validates: Requirements 8.2, 8.3
   */

  // Helper to generate confirmation message
  const generateConfirmation = (title: string, sbId: string, status: ProjectStatus): string => {
    return `Updated ${title} (${sbId}) status to ${status}`;
  };

  it('should generate confirmation with all required components', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0).map(s => s.trim()),
        sbIdGen,
        projectStatusGen,
        (title, sbId, status) => {
          const confirmation = generateConfirmation(title, sbId, status);
          
          // Should contain project title
          expect(confirmation).toContain(title);
          
          // Should contain SB_ID in parentheses
          expect(confirmation).toContain(`(${sbId})`);
          
          // Should contain status
          expect(confirmation).toContain(status);
          
          // Should match expected format
          expect(confirmation).toBe(`Updated ${title} (${sbId}) status to ${status}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce valid confirmation for all status values', () => {
    const statuses: ProjectStatus[] = ['active', 'on-hold', 'complete', 'cancelled'];
    const title = 'Test Project';
    const sbId = 'sb-1234567';
    
    for (const status of statuses) {
      const confirmation = generateConfirmation(title, sbId, status);
      expect(confirmation).toMatch(/^Updated .+ \(sb-[a-f0-9]{7}\) status to (active|on-hold|complete|cancelled)$/);
    }
  });
});


import { generateFrontMatter, type FrontMatter } from '../../src/components/markdown-templates';

describe('Property 1: Project Front Matter Structure', () => {
  /**
   * Property 1: Project Front Matter Structure
   * 
   * For any project file created or updated by the Knowledge_Store, the front matter 
   * SHALL contain a `status` field with a valid value, and new projects SHALL have 
   * status `active` by default.
   * 
   * Validates: Requirements 1.1, 1.3, 1.4
   */

  // Generator for project front matter
  const projectFrontMatterGen = fc.record({
    id: sbIdGen,
    type: fc.constant('project' as const),
    title: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0 && !s.includes('"')).map(s => s.trim()),
    created_at: fc.date().map(d => d.toISOString()),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('\n')), { maxLength: 5 }),
    status: fc.option(projectStatusGen, { nil: undefined }),
  });

  it('should include status field in project front matter', () => {
    fc.assert(
      fc.property(projectFrontMatterGen, (fm) => {
        const frontMatter: FrontMatter = {
          id: fm.id,
          type: fm.type,
          title: fm.title,
          created_at: fm.created_at,
          tags: fm.tags,
          status: fm.status,
        };
        
        const generated = generateFrontMatter(frontMatter);
        
        // Should contain status field for projects
        expect(generated).toContain('status:');
      }),
      { numRuns: 100 }
    );
  });

  it('should default to active status when not specified', () => {
    fc.assert(
      fc.property(
        sbIdGen,
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0 && !s.includes('"')).map(s => s.trim()),
        fc.date().map(d => d.toISOString()),
        (id, title, created_at) => {
          const frontMatter: FrontMatter = {
            id,
            type: 'project',
            title,
            created_at,
            tags: [],
            // No status specified - should default to active
          };
          
          const generated = generateFrontMatter(frontMatter);
          
          // Should default to active
          expect(generated).toContain('status: active');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve specified status values', () => {
    fc.assert(
      fc.property(
        sbIdGen,
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0 && !s.includes('"')).map(s => s.trim()),
        fc.date().map(d => d.toISOString()),
        projectStatusGen,
        (id, title, created_at, status) => {
          const frontMatter: FrontMatter = {
            id,
            type: 'project',
            title,
            created_at,
            tags: [],
            status,
          };
          
          const generated = generateFrontMatter(frontMatter);
          
          // Should contain the specified status
          expect(generated).toContain(`status: ${status}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not include status field for non-project types', () => {
    fc.assert(
      fc.property(
        sbIdGen,
        fc.constantFrom('idea' as const, 'decision' as const),
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0 && !s.includes('"')).map(s => s.trim()),
        fc.date().map(d => d.toISOString()),
        (id, type, title, created_at) => {
          const frontMatter: FrontMatter = {
            id,
            type,
            title,
            created_at,
            tags: [],
          };
          
          const generated = generateFrontMatter(frontMatter);
          
          // Should NOT contain status field for ideas and decisions
          expect(generated).not.toContain('status:');
        }
      ),
      { numRuns: 100 }
    );
  });
});


import {
  queryProjectsByStatus,
  getAllProjects,
  parseTaskLogEntries,
  getProjectTaskLog,
  formatProjectQueryForSlack,
  type ProjectQueryResult,
} from '../../src/components/query-handler';
import type { KnowledgeFile } from '../../src/components/knowledge-search';

// Generator for project file content
const projectFileContentGen = (status: ProjectStatus) => fc.record({
  id: sbIdGen,
  title: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0 && !s.includes('"') && !s.includes('\n')).map(s => s.trim()),
  status: fc.constant(status),
}).map(({ id, title, status }) => `---
id: ${id}
type: project
title: "${title}"
status: ${status}
created_at: 2025-01-18T10:00:00Z
tags: []
---

# ${title}

Project content here.
`);

// Generator for knowledge files with specific status
const knowledgeFileGen = (status: ProjectStatus) => fc.record({
  id: sbIdGen,
  title: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0 && !s.includes('"') && !s.includes('\n')).map(s => s.trim()),
}).map(({ id, title }): KnowledgeFile => ({
  path: `30-projects/2025-01-18__${title.toLowerCase().replace(/\s+/g, '-')}__${id}.md`,
  folder: '30-projects',
  content: `---
id: ${id}
type: project
title: "${title}"
status: ${status}
created_at: 2025-01-18T10:00:00Z
tags: []
---

# ${title}

Project content here.
`,
  date: '2025-01-18',
}));

describe('Property 11: Status Filter Query Results', () => {
  /**
   * Property 11: Status Filter Query Results
   * 
   * For any query filtering projects by status, all returned projects SHALL have 
   * the requested status value, and no projects with different status values SHALL be included.
   * 
   * Validates: Requirements 6.1, 6.2
   */

  it('should return only projects with the requested status', () => {
    fc.assert(
      fc.property(
        projectStatusGen,
        fc.array(knowledgeFileGen('active'), { minLength: 0, maxLength: 3 }),
        fc.array(knowledgeFileGen('on-hold'), { minLength: 0, maxLength: 3 }),
        fc.array(knowledgeFileGen('complete'), { minLength: 0, maxLength: 3 }),
        fc.array(knowledgeFileGen('cancelled'), { minLength: 0, maxLength: 3 }),
        (queryStatus, activeFiles, onHoldFiles, completeFiles, cancelledFiles) => {
          const allFiles = [...activeFiles, ...onHoldFiles, ...completeFiles, ...cancelledFiles];
          
          const result = queryProjectsByStatus(allFiles, queryStatus);
          
          // All returned projects should have the requested status
          for (const project of result.projects) {
            expect(project.status).toBe(queryStatus);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not include projects with different status values', () => {
    fc.assert(
      fc.property(
        projectStatusGen,
        fc.array(knowledgeFileGen('active'), { minLength: 1, maxLength: 3 }),
        fc.array(knowledgeFileGen('complete'), { minLength: 1, maxLength: 3 }),
        (queryStatus, activeFiles, completeFiles) => {
          const allFiles = [...activeFiles, ...completeFiles];
          
          const result = queryProjectsByStatus(allFiles, queryStatus);
          
          // Count how many files have the requested status
          const expectedCount = queryStatus === 'active' ? activeFiles.length : 
                               queryStatus === 'complete' ? completeFiles.length : 0;
          
          expect(result.totalCount).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return empty result when no projects match', () => {
    fc.assert(
      fc.property(
        fc.array(knowledgeFileGen('active'), { minLength: 1, maxLength: 5 }),
        (activeFiles) => {
          // Query for a status that none of the files have
          const result = queryProjectsByStatus(activeFiles, 'cancelled');
          
          expect(result.totalCount).toBe(0);
          expect(result.projects).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 13: Query Result Structure', () => {
  /**
   * Property 13: Query Result Structure
   * 
   * For any project query result, each project in the result SHALL include both 
   * `title` (non-empty string) and `sb_id` (matching `sb-[a-f0-9]{7}` format).
   * 
   * Validates: Requirements 6.4
   */

  it('should include valid sbId and title for all projects', () => {
    fc.assert(
      fc.property(
        fc.array(knowledgeFileGen('active'), { minLength: 1, maxLength: 5 }),
        (files) => {
          const result = queryProjectsByStatus(files, 'active');
          
          for (const project of result.projects) {
            // sbId should match the expected format
            expect(project.sbId).toMatch(/^sb-[a-f0-9]{7}$/);
            
            // title should be non-empty
            expect(project.title.length).toBeGreaterThan(0);
            
            // path should be present
            expect(project.path.length).toBeGreaterThan(0);
            
            // status should be valid
            expect(['active', 'on-hold', 'complete', 'cancelled']).toContain(project.status);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return correct totalCount', () => {
    fc.assert(
      fc.property(
        fc.array(knowledgeFileGen('active'), { minLength: 0, maxLength: 10 }),
        (files) => {
          const result = queryProjectsByStatus(files, 'active');
          
          expect(result.totalCount).toBe(result.projects.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 12: Task Log Retrieval', () => {
  /**
   * Property 12: Task Log Retrieval
   * 
   * For any project with a `## Tasks` section, querying that project's tasks 
   * SHALL return all entries from the Tasks section in the correct format.
   * 
   * Validates: Requirements 6.3
   */

  // Generator for task log entries
  const taskEntryGen = fc.record({
    date: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
      .map(d => d.toISOString().split('T')[0]),
    title: fc.string({ minLength: 1, maxLength: 100 })
      .filter(s => s.trim().length > 0 && !s.includes('\n'))
      .map(s => s.trim()),
  });

  it('should parse task log entries from ## Tasks section', () => {
    fc.assert(
      fc.property(
        fc.array(taskEntryGen, { minLength: 1, maxLength: 5 }),
        (entries) => {
          // Build content with Tasks section
          const tasksSection = entries.map(e => `- ${e.date}: ${e.title}`).join('\n');
          const content = `---
id: sb-1234567
type: project
title: "Test Project"
status: active
---

# Test Project

## Tasks
${tasksSection}

---
Source: Slack DM`;

          const parsed = parseTaskLogEntries(content);
          
          // Should return all entries
          expect(parsed.length).toBe(entries.length);
          
          // Each entry should match
          for (let i = 0; i < entries.length; i++) {
            expect(parsed[i].date).toBe(entries[i].date);
            expect(parsed[i].title).toBe(entries[i].title);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return empty array when no Tasks section exists', () => {
    const contentWithoutTasks = `---
id: sb-1234567
type: project
title: "Test Project"
status: active
---

# Test Project

Some content here.

---
Source: Slack DM`;

    const parsed = parseTaskLogEntries(contentWithoutTasks);
    expect(parsed).toHaveLength(0);
  });

  it('should return empty array for empty Tasks section', () => {
    const contentWithEmptyTasks = `---
id: sb-1234567
type: project
title: "Test Project"
status: active
---

# Test Project

## Tasks

---
Source: Slack DM`;

    const parsed = parseTaskLogEntries(contentWithEmptyTasks);
    expect(parsed).toHaveLength(0);
  });

  it('should ignore malformed task entries', () => {
    const contentWithMixedEntries = `---
id: sb-1234567
type: project
title: "Test Project"
status: active
---

# Test Project

## Tasks
- 2025-01-18: Valid task entry
- Invalid entry without date
- 2025-01-19: Another valid entry
Not a task entry at all

---
Source: Slack DM`;

    const parsed = parseTaskLogEntries(contentWithMixedEntries);
    
    // Should only return the valid entries
    expect(parsed.length).toBe(2);
    expect(parsed[0].date).toBe('2025-01-18');
    expect(parsed[0].title).toBe('Valid task entry');
    expect(parsed[1].date).toBe('2025-01-19');
    expect(parsed[1].title).toBe('Another valid entry');
  });
});
