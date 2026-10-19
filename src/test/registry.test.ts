import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  addAccount,
  assertValidName,
  emptyRegistry,
  loadRegistry,
  removeAccount,
  saveRegistry,
  setDefaultAccount,
  type AccountRecord,
} from '../accounts/registry.js';

const record = (name: string, userId = `user-${name}`): AccountRecord => ({
  name,
  email: `${name}@example.com`,
  userId,
  source: 'login',
  addedAt: '2026-10-19T00:00:00.000Z',
});

describe('account names', () => {
  it('accepts plain lowercase names', () => {
    for (const name of ['work', 'personal-2', 'a', '0team']) {
      assert.doesNotThrow(() => assertValidName(name));
    }
  });

  it('rejects uppercase, spaces, commas, leading hyphens and over-long names', () => {
    for (const name of ['Work', 'my team', 'a,b', '-x', 'x'.repeat(33), '']) {
      assert.throws(() => assertValidName(name), /Invalid account name/);
    }
  });

  it('reserves "all", which is the fan-out keyword', () => {
    assert.throws(() => assertValidName('all'), /reserved/);
  });
});

describe('registry changes', () => {
  it('makes the first account the default', () => {
    const registry = addAccount(emptyRegistry(), record('work'));
    assert.equal(registry.default, 'work');
  });

  it('keeps the default when a second account is added', () => {
    const registry = addAccount(addAccount(emptyRegistry(), record('work')), record('personal'));
    assert.equal(registry.default, 'work');
    assert.equal(registry.accounts.length, 2);
  });

  it('refuses a duplicate name', () => {
    const registry = addAccount(emptyRegistry(), record('work'));
    assert.throws(() => addAccount(registry, record('work', 'other-user')), /already exists/);
  });

  it('refuses the same Netlify login under a second name', () => {
    const registry = addAccount(emptyRegistry(), record('work', 'shared-user'));
    assert.throws(() => addAccount(registry, record('again', 'shared-user')), /already added as "work"/);
  });

  it('clears the default when that account is removed', () => {
    const registry = addAccount(addAccount(emptyRegistry(), record('work')), record('personal'));
    const after = removeAccount(registry, 'work');
    assert.equal(after.default, undefined);
    assert.deepEqual(after.accounts.map((account) => account.name), ['personal']);
  });

  it('rejects removing or defaulting an unknown account', () => {
    assert.throws(() => removeAccount(emptyRegistry(), 'nope'), /No account named/);
    assert.throws(() => setDefaultAccount(emptyRegistry(), 'nope'), /No account named/);
  });
});

describe('registry file', () => {
  it('round-trips and never writes anything that looks like a token', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'registry-test-'));
    try {
      const file = path.join(dir, 'accounts.json');
      const registry = setDefaultAccount(addAccount(emptyRegistry(), record('work')), 'work');
      await saveRegistry(file, registry);

      assert.deepEqual(await loadRegistry(file), registry);
      const raw = await readFile(file, 'utf8');
      assert.equal(/token|nfp_|nfu_/i.test(raw), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty registry when the file does not exist yet', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'registry-test-'));
    try {
      assert.deepEqual(await loadRegistry(path.join(dir, 'missing.json')), emptyRegistry());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
