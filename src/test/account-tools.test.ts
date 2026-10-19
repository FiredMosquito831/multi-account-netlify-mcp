import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addAccount, emptyRegistry, setDefaultAccount, type AccountRecord, type Registry } from '../accounts/registry.js';
import { NAME_PATTERN } from '../accounts/registry.js';
import { ACCOUNT_ADD_TOOL, ACCOUNT_LIST_TOOL, ACCOUNT_TOOLS, accountLines } from '../mux/account-tools.js';

const record = (name: string, source: AccountRecord['source'] = 'login'): AccountRecord => ({
  name,
  email: `${name}@example.com`,
  userId: `user-${name}`,
  source,
  addedAt: '2026-10-19T00:00:00.000Z',
});

describe('the account tools', () => {
  it('are account_add and account_list', () => {
    assert.deepEqual(ACCOUNT_TOOLS.map((tool) => tool.name), [ACCOUNT_ADD_TOOL, ACCOUNT_LIST_TOOL]);
  });

  it('give account_add one required name, with the same pattern as the registry', () => {
    const add = ACCOUNT_TOOLS.find((tool) => tool.name === ACCOUNT_ADD_TOOL);
    assert.ok(add);
    assert.deepEqual(add.inputSchema.required, ['name']);
    const nameSchema = add.inputSchema.properties?.name as { pattern?: string };
    assert.equal(nameSchema.pattern, NAME_PATTERN.source);
  });

  it('take no account argument, because they never reach a Netlify child', () => {
    for (const tool of ACCOUNT_TOOLS) {
      assert.equal(tool.inputSchema.properties?.account, undefined, tool.name);
    }
  });

  it('say that tokens are never taken or shown in the chat', () => {
    const add = ACCOUNT_TOOLS.find((tool) => tool.name === ACCOUNT_ADD_TOOL);
    assert.match(add?.description ?? '', /never shown in the chat/);
    assert.match(add?.description ?? '', /--pat/);
  });
});

describe('the account list', () => {
  it('says how to add the first account when none exist', () => {
    const lines = accountLines(emptyRegistry());
    assert.equal(lines.length, 1);
    assert.match(lines[0], /No accounts yet/);
  });

  it('lists each account and marks the default', () => {
    const registry: Registry = setDefaultAccount(
      addAccount(addAccount(emptyRegistry(), record('work')), record('personal', 'pat')),
      'personal',
    );
    const lines = accountLines(registry);
    assert.equal(lines[0], '  work\twork@example.com\tlogin');
    assert.equal(lines[1], '* personal\tpersonal@example.com\tpat');
  });

  it('warns when no default is set', () => {
    const lines = accountLines({ accounts: [record('work')] });
    assert.equal(lines.at(-1), 'No default account. Calls must name one, or use "all".');
  });

  it('never shows a token', () => {
    const text = accountLines(addAccount(emptyRegistry(), record('work'))).join('\n');
    assert.doesNotMatch(text, /token/i);
  });
});
