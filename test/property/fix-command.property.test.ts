/**
 * Property-Based Tests: Fix Command Parsing
 * 
 * Validates: Requirement 10.1 (Fix Command)
 * 
 * Property 11: For any message text, the parseFixCommand function SHALL return
 * isFixCommand=true if and only if the message starts with "fix:" or "fix "
 * (case-insensitive), and the instruction SHALL be the remaining text.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseFixCommand, isFixCommand } from '../../src/components/fix-handler';

describe('Property 11: Fix Command Parsing', () => {
  /**
   * Property: Messages starting with "fix:" are recognized as fix commands
   */
  it('should recognize fix: prefix (case-insensitive)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('fix:'), fc.constant('Fix:'), fc.constant('FIX:')),
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        (prefix, instruction) => {
          const message = `${prefix} ${instruction}`;
          const result = parseFixCommand(message);
          
          expect(result.isFixCommand).toBe(true);
          expect(result.instruction.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Messages starting with "fix " (without colon) are recognized
   */
  it('should recognize fix prefix without colon', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('fix'), fc.constant('Fix'), fc.constant('FIX')),
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        (prefix, instruction) => {
          const message = `${prefix} ${instruction}`;
          const result = parseFixCommand(message);
          
          expect(result.isFixCommand).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Messages not starting with fix are not recognized
   */
  it('should not recognize non-fix messages', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => {
          const lower = s.toLowerCase().trim();
          return !lower.startsWith('fix:') && !lower.startsWith('fix ');
        }),
        (message) => {
          const result = parseFixCommand(message);
          expect(result.isFixCommand).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Instruction is trimmed
   */
  it('should trim instruction whitespace', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (instruction) => {
          const message = `fix:   ${instruction}   `;
          const result = parseFixCommand(message);
          
          expect(result.instruction).toBe(instruction.trim());
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: isFixCommand is consistent with parseFixCommand
   */
  it('should have consistent isFixCommand helper', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        (message) => {
          const parsed = parseFixCommand(message);
          const helper = isFixCommand(message);
          
          expect(helper).toBe(parsed.isFixCommand);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Empty and whitespace-only messages are not fix commands
   */
  it('should not recognize empty or whitespace messages', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant('   '),
          fc.constant('\t\n'),
          fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 10 })
        ),
        (message) => {
          const result = parseFixCommand(message);
          expect(result.isFixCommand).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  });
});
