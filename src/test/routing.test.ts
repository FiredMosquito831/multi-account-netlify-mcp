import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addAccount, emptyRegistry, setDefaultAccount, type AccountRecord, type Registry } from '../accounts/registry.js';
import { resolveTargets } from '../mux/routing.js';

const record = (name: string): AccountRecord => ({
  name,
  email: `${name}@example.com`,
  userId: `user-${name}`,
  source: 'login',
  addedAt: '2026-10-19T00:00:00.000Z',
});

const withAccounts = (...names: string[]): Registry =>
  names.reduce((registry, name) => addAccount(registry, record(name)), emptyRegistry());

describe('resolveTargets', () => {
  it('fails clearly when there are no accounts', () => {
    assert.throws(() => resolveTargets(undefined, emptyRegistry()), /No Netlify accounts are set up yet/);
  });

  it('uses the only account when there is just one and no default is needed', () => {
    const registry = { accounts: [record('work')] };
    assert.deepEqual(resolveTargets(undefined, registry), { accounts: ['work'], multi: false });
  });

  it('uses the default account when the argument is left out', () => {
    const registry = setDefaultAccount(withAccounts('work', 'personal'), 'personal');
    assert.deepEqual(resolveTargets(undefined, registry), { accounts: ['personal'], multi: false });
    assert.deepEqual(resolveTargets('', registry), { accounts: ['personal'], multi: false });
  });

  it('refuses to guess when several accounts exist and none is the default', () => {
    const registry = { ...withAccounts('work', 'personal'), default: undefined };
    assert.throws(() => resolveTargets(undefined, registry), /No default account is set.*work, personal/);
  });

  it('routes a single name to that account only', () => {
    assert.deepEqual(resolveTargets('personal', withAccounts('work', 'personal')), {
      accounts: ['personal'],
      multi: false,
    });
  });

  it('treats "all" as every account, in any letter case', () => {
    assert.deepEqual(resolveTargets('ALL', withAccounts('work', 'personal')), {
      accounts: ['work', 'personal'],
      multi: true,
    });
  });

  it('accepts a comma-separated list, trims spaces and drops duplicates', () => {
    assert.deepEqual(resolveTargets(' work , personal,work ', withAccounts('work', 'personal', 'client')), {
      accounts: ['work', 'personal'],
      multi: true,
    });
  });

  it('names every unknown account in the error', () => {
    assert.throws(
      () => resolveTargets('work,ghost,phantom', withAccounts('work')),
      /Unknown accounts: ghost, phantom\. Known accounts: work\./,
    );
  });

  it('rejects a non-string account value', () => {
    assert.throws(() => resolveTargets(42, withAccounts('work')), /must be a string/);
  });
});
