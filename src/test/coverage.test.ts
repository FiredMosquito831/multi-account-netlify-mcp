import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OPERATION_MODES, MIXED_OPERATIONS } from '../mux/policy.js';
import { OfficialChild } from '../mux/official-child.js';

// Runs against the installed @netlify/mcp. If an official update adds or removes an operation,
// this fails until the policy table in src/mux/policy.ts is updated, so a new operation cannot
// reach a multi-account call unclassified.
const LONG = { timeout: 120_000 };

describe('policy covers every official operation', () => {
  it('lists exactly the operations the policy table knows', LONG, async () => {
    const child = await OfficialChild.start('coverage-check');
    try {
      const official = new Set<string>();
      for (const tool of await child.listTools()) {
        const selector = tool.inputSchema?.properties?.selectSchema as Record<string, unknown> | undefined;
        const variants = (selector?.anyOf as Record<string, any>[] | undefined) ?? (selector ? [selector] : []);
        for (const variant of variants) {
          const operation = variant?.properties?.operation?.const;
          if (typeof operation === 'string') {
            official.add(operation);
          }
        }
      }

      const known = new Set([...Object.keys(OPERATION_MODES), ...MIXED_OPERATIONS]);
      const unclassified = [...official].filter((operation) => !known.has(operation));
      const gone = [...known].filter((operation) => !official.has(operation));
      assert.deepEqual(unclassified, [], 'official operations missing from src/mux/policy.ts');
      assert.deepEqual(gone, [], 'policy entries the official server no longer has');
      assert.equal(official.size, 25);
    } finally {
      await child.close();
    }
  });
});
