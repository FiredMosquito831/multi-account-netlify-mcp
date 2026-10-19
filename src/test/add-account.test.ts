import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { addAccountInChat, storeNewAccount, type InChatDeps } from '../accounts/add-account.js';
import { loadRegistry } from '../accounts/registry.js';
import type { TokenStore } from '../secrets/token-store.js';

// An in-memory token store, so the test never touches the real credential store.
const memoryTokens = (): TokenStore & { entries: Map<string, string> } => {
  const entries = new Map<string, string>();
  return {
    entries,
    get: (name) => entries.get(name) ?? null,
    set: (name, token) => {
      entries.set(name, token);
    },
    delete: (name) => entries.delete(name),
  };
};

// What Netlify answers for each token. A token that is not listed is refused, as Netlify refuses a bad token.
const netlifyFor =
  (users: Record<string, { id: string; email: string }>) =>
  async (token: string): Promise<{ id: string; email: string }> => {
    const user = users[token];
    if (!user) {
      throw new Error('Netlify rejected this token (HTTP 401).');
    }
    return user;
  };

const users = {
  'token-a': { id: 'user-a', email: 'a@example.com' },
  'token-b': { id: 'user-b', email: 'b@example.com' },
};

describe('adding an account from the chat', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'add-account-test-'));
    file = path.join(dir, 'accounts.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Builds the dependencies for one add. Each login is recorded, so a test can check that none ran.
  const setup = (token: string, overrides: Partial<InChatDeps> = {}) => {
    const logins: string[] = [];
    const tokens = memoryTokens();
    const deps: InChatDeps = {
      file,
      tokens,
      fetchUser: netlifyFor(users),
      login: async (name) => {
        logins.push(name);
        return { token };
      },
      pending: new Set(),
      ...overrides,
    };
    return { deps, tokens, logins };
  };

  it('stores the token and the account after a browser login, and makes the first account the default', async () => {
    const { deps, tokens, logins } = setup('token-a');
    const message = await addAccountInChat(deps, 'work');

    assert.deepEqual(logins, ['work']);
    const registry = await loadRegistry(file);
    assert.equal(registry.accounts.length, 1);
    assert.equal(registry.accounts[0].name, 'work');
    assert.equal(registry.accounts[0].email, 'a@example.com');
    assert.equal(registry.accounts[0].source, 'login');
    assert.equal(registry.default, 'work');
    assert.equal(tokens.get('work'), 'token-a');
    assert.match(message, /Added "work" \(a@example\.com\)\. It is the default account\./);
    assert.match(message, /Restart the agent/);
  });

  it('never writes the token into the accounts file', async () => {
    const { deps } = setup('token-a');
    await addAccountInChat(deps, 'work');
    assert.doesNotMatch(await readFile(file, 'utf8'), /token-a/);
  });

  it('a second account is added without taking the default', async () => {
    const first = setup('token-a');
    await addAccountInChat(first.deps, 'work');
    const second = setup('token-b', { tokens: first.tokens });
    const message = await addAccountInChat(second.deps, 'personal');

    const registry = await loadRegistry(file);
    assert.deepEqual(registry.accounts.map((account) => account.name), ['work', 'personal']);
    assert.equal(registry.default, 'work');
    assert.doesNotMatch(message, /default account/);
  });

  it('refuses a name that is taken before any browser login opens', async () => {
    const first = setup('token-a');
    await addAccountInChat(first.deps, 'work');
    const second = setup('token-b', { tokens: first.tokens });
    await assert.rejects(addAccountInChat(second.deps, 'work'), /already exists/);
    assert.deepEqual(second.logins, []);
  });

  it('refuses a name that is not valid before any browser login opens', async () => {
    const { deps, logins } = setup('token-a');
    await assert.rejects(addAccountInChat(deps, 'Not Valid'));
    assert.deepEqual(logins, []);
  });

  it('refuses a second login for a name whose login is still running', async () => {
    const { deps, logins } = setup('token-a', { pending: new Set(['work']) });
    await assert.rejects(addAccountInChat(deps, 'work'), /already running/);
    assert.deepEqual(logins, []);
  });

  it('stores nothing when the login fails, and frees the name for another try', async () => {
    const failing = setup('token-a', {
      login: async () => {
        throw new Error('netlify login exited with code 1: the sign-in was cancelled');
      },
    });
    await assert.rejects(addAccountInChat(failing.deps, 'work'), /cancelled/);
    assert.equal(failing.tokens.entries.size, 0);
    assert.deepEqual((await loadRegistry(file)).accounts, []);
    assert.equal(failing.deps.pending.size, 0);

    const retry = setup('token-a', { tokens: failing.tokens });
    await addAccountInChat(retry.deps, 'work');
    assert.equal(failing.tokens.entries.get('work'), 'token-a');
  });

  it('stores nothing when Netlify refuses the token', async () => {
    const { deps, tokens } = setup('bad-token');
    await assert.rejects(addAccountInChat(deps, 'work'), /rejected this token/);
    assert.equal(tokens.entries.size, 0);
    assert.deepEqual((await loadRegistry(file)).accounts, []);
  });

  it('refuses the same Netlify user under a second name, and stores no second token', async () => {
    const first = setup('token-a');
    await addAccountInChat(first.deps, 'work');
    const again = setup('token-a', { tokens: first.tokens });
    await assert.rejects(addAccountInChat(again.deps, 'again'));
    assert.equal(first.tokens.entries.has('again'), false);
    assert.equal((await loadRegistry(file)).accounts.length, 1);
  });
});

describe('storing a new account', () => {
  it('records a token typed by hand as a pat account', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'add-account-pat-'));
    try {
      const file = path.join(dir, 'accounts.json');
      const tokens = memoryTokens();
      const stored = await storeNewAccount({ file, tokens, fetchUser: netlifyFor(users) }, 'personal', 'token-b', 'pat');
      assert.equal(stored.account.source, 'pat');
      assert.equal(stored.account.email, 'b@example.com');
      assert.equal(tokens.get('personal'), 'token-b');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
