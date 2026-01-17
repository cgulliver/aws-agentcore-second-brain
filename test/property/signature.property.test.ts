/**
 * Property-Based Tests: Signature Verification
 * 
 * Validates: Requirements 1.1, 1.3 (Slack Request Verification)
 * 
 * Property 1: For any Slack request with a body, timestamp, and signature,
 * the verifySlackSignature function SHALL return true if and only if the
 * signature matches the HMAC-SHA256 of v0:{timestamp}:{body} using the signing secret.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createHmac } from 'crypto';
import { verifySlackSignature } from '../../src/handlers/ingress';

describe('Property 1: Signature Verification', () => {
  /**
   * Property: Valid signatures are always accepted
   */
  it('should accept any correctly computed signature', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 64 }), // signing secret
        fc.string({ minLength: 1, maxLength: 1000 }), // body
        fc.integer({ min: 1000000000, max: 2000000000 }), // timestamp (Unix)
        (secret, body, timestamp) => {
          const timestampStr = timestamp.toString();
          const baseString = `v0:${timestampStr}:${body}`;
          const hmac = createHmac('sha256', secret);
          hmac.update(baseString);
          const signature = `v0=${hmac.digest('hex')}`;

          expect(verifySlackSignature(secret, timestampStr, body, signature)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Invalid signatures are always rejected
   */
  it('should reject any incorrectly computed signature', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 64 }), // signing secret
        fc.string({ minLength: 1, maxLength: 1000 }), // body
        fc.integer({ min: 1000000000, max: 2000000000 }), // timestamp
        fc.hexaString({ minLength: 64, maxLength: 64 }), // random hex (wrong signature)
        (secret, body, timestamp, randomHex) => {
          const timestampStr = timestamp.toString();
          
          // Compute correct signature to ensure we're testing with a different one
          const baseString = `v0:${timestampStr}:${body}`;
          const hmac = createHmac('sha256', secret);
          hmac.update(baseString);
          const correctSignature = `v0=${hmac.digest('hex')}`;
          
          // Only test if random hex is different from correct signature
          const wrongSignature = `v0=${randomHex}`;
          if (wrongSignature !== correctSignature) {
            expect(verifySlackSignature(secret, timestampStr, body, wrongSignature)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Signature verification is deterministic
   */
  it('should produce consistent results for the same inputs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        fc.integer({ min: 1000000000, max: 2000000000 }),
        (secret, body, timestamp) => {
          const timestampStr = timestamp.toString();
          const baseString = `v0:${timestampStr}:${body}`;
          const hmac = createHmac('sha256', secret);
          hmac.update(baseString);
          const signature = `v0=${hmac.digest('hex')}`;

          // Call multiple times, should always return same result
          const result1 = verifySlackSignature(secret, timestampStr, body, signature);
          const result2 = verifySlackSignature(secret, timestampStr, body, signature);
          const result3 = verifySlackSignature(secret, timestampStr, body, signature);

          expect(result1).toBe(result2);
          expect(result2).toBe(result3);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Different secrets produce different signatures
   */
  it('should reject signature computed with different secret', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        fc.integer({ min: 1000000000, max: 2000000000 }),
        (secret1, secret2, body, timestamp) => {
          // Only test if secrets are different
          if (secret1 === secret2) return;

          const timestampStr = timestamp.toString();
          const baseString = `v0:${timestampStr}:${body}`;
          
          // Compute signature with secret1
          const hmac = createHmac('sha256', secret1);
          hmac.update(baseString);
          const signature = `v0=${hmac.digest('hex')}`;

          // Verify with secret2 should fail
          expect(verifySlackSignature(secret2, timestampStr, body, signature)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
