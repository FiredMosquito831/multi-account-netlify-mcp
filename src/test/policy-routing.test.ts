import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client, InMemoryTransport, type CallToolResult, type Tool } from '@modelcontextprotocol/client';
import { addAccount, emptyRegistry, type AccountRecord, type Registry } from '../accounts/registry.js';
import { createMuxServer } from '../mux/server.js';
import { Multiplexer, type ChildStarter } from '../mux/multiplexer.js';
import type { OfficialChild } from '../mux/official-child.js';
import type { TokenStore } from '../secrets/token-store.js';

// Routing behaviour per operation. Each fake account is named by its token:
// "ok" answers, "missing" says it does not own the id (404), "expired" is an auth error.
const TOOLS: Tool[] = [{ name: 'netlify-project-services-reader', inputSchema: { type: 'object' } }];

const account = (name: string): AccountRecord => ({
  name,
  email: `${name}@example.com`,
  userId: `user-${name}`,
  source: 'login',
  addedAt: '2026-10-19T00:00:00.000Z',
});

const registryOf = (...names: string[]): Registry => names.reduce((r, name) => addAccount(r, account(name)), emptyRegistry());

const session = async (tokens: Record<string, string>, registry: Registry) => {
  const calls: { child: string; tool: string; args: Record<string, unknown> }[] = [];
  const start: ChildStarter = async (id, token) =>
    ({
      closed: false,
      onExit() {},
      async listTools() {
        return TOOLS;
      },
      async callTool(tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
        calls.push({ child: id, tool, args });
        if (token === 'missing') {
          return { isError: true, content: [{ type: 'text', text: 'Failed to fetch API: 404' }] };
        }
        if (token === 'expired') {
          return { isError: true, content: [{ type: 'text', text: 'Netlify rejected this token (HTTP 401).' }] };
        }
        return { content: [{ type: 'text', text: `${id}:${tool}` }] };
      },
      async close() {},
    }) as unknown as OfficialChild;
  const tokenStore: TokenStore = { get: (name) => tokens[name] ?? null, set() {}, delete: () => true };
  const multiplexer = new Multiplexer(tokenStore, start);
  const server = createMuxServer({ multiplexer, loadRegistry: async () => registry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'routing-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return {
    calls,
    call: (args: Record<string, unknown>) => client.callTool({ name: 'netlify-project-services-reader', arguments: args }) as Promise<CallToolResult>,
    close: async () => {
      await client.close();
      await multiplexer.close();
    },
  };
};

const textOf = (result: CallToolResult): string => (result.content[0] as { text: string }).text;
const selector = (operation: string, params: Record<string, unknown> = {}) => ({ operation, params });

describe('writes stay on one account', () => {
  it('refuses a write sent to all, before any account is called', async () => {
    const s = await session({ work: 'ok', personal: 'ok' }, registryOf('work', 'personal'));
    try {
      const result = await s.call({ account: 'all', selectSchema: selector('deploy-site') });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /"deploy-site" runs on one account only/);
      assert.equal(s.calls.length, 0);
    } finally {
      await s.close();
    }
  });

  it('refuses a write sent to a comma list', async () => {
    const s = await session({ work: 'ok', personal: 'ok' }, registryOf('work', 'personal'));
    try {
      const result = await s.call({ account: 'work,personal', selectSchema: selector('update-forms') });
      assert.equal(result.isError, true);
      assert.equal(s.calls.length, 0);
    } finally {
      await s.close();
    }
  });

  it('runs a write on the one account it names', async () => {
    const s = await session({ work: 'ok', personal: 'ok' }, registryOf('work', 'personal'));
    try {
      const result = await s.call({ account: 'personal', selectSchema: selector('deploy-site') });
      assert.equal(textOf(result), 'personal:netlify-project-services-reader');
    } finally {
      await s.close();
    }
  });

  it('refuses an operation the table does not know, sent to all', async () => {
    const s = await session({ work: 'ok', personal: 'ok' }, registryOf('work', 'personal'));
    try {
      const result = await s.call({ account: 'all', selectSchema: selector('brand-new-operation') });
      assert.equal(result.isError, true);
      assert.equal(s.calls.length, 0);
    } finally {
      await s.close();
    }
  });

  it('refuses the write half of a mixed operation sent to all', async () => {
    const s = await session({ work: 'ok', personal: 'ok' }, registryOf('work', 'personal'));
    try {
      const env = await s.call({ account: 'all', selectSchema: selector('manage-env-vars', { upsertEnvVar: true, envVarKey: 'X' }) });
      const submissions = await s.call({ account: 'all', selectSchema: selector('manage-form-submissions', { action: 'delete-submission' }) });
      assert.equal(env.isError, true);
      assert.equal(submissions.isError, true);
      assert.equal(s.calls.length, 0);
    } finally {
      await s.close();
    }
  });
});

describe('reads fan out', () => {
  it('lets a read with no id run on all accounts', async () => {
    const s = await session({ work: 'ok', personal: 'ok' }, registryOf('work', 'personal'));
    try {
      const result = await s.call({ account: 'all', selectSchema: selector('get-projects') });
      const body = JSON.parse(textOf(result)) as { accounts: Record<string, unknown>; notFoundIn?: string[] };
      assert.deepEqual(Object.keys(body.accounts).sort(), ['personal', 'work']);
      assert.equal(body.notFoundIn, undefined, 'no notFoundIn list outside locate mode');
    } finally {
      await s.close();
    }
  });

  it('lets a read of sensitive data (env var values) run on all accounts', async () => {
    const s = await session({ work: 'ok', personal: 'ok' }, registryOf('work', 'personal'));
    try {
      const result = await s.call({ account: 'all', selectSchema: selector('manage-env-vars', { getAllEnvVars: true }) });
      const body = JSON.parse(textOf(result)) as { accounts: Record<string, { ok: boolean }> };
      assert.equal(body.accounts.work.ok, true);
      assert.equal(body.accounts.personal.ok, true);
    } finally {
      await s.close();
    }
  });

  it('drops accounts that do not own the id, and reports them by name', async () => {
    const s = await session({ owner: 'ok', other: 'missing' }, registryOf('owner', 'other'));
    try {
      const result = await s.call({ account: 'all', selectSchema: selector('get-project', { siteId: 'abc' }) });
      const body = JSON.parse(textOf(result)) as { accounts: Record<string, unknown>; notFoundIn: string[] };
      assert.deepEqual(Object.keys(body.accounts), ['owner']);
      assert.deepEqual(body.notFoundIn, ['other']);
      assert.notEqual(result.isError, true);
    } finally {
      await s.close();
    }
  });

  it('reports not found when no account owns the id', async () => {
    const s = await session({ one: 'missing', two: 'missing' }, registryOf('one', 'two'));
    try {
      const result = await s.call({ account: 'all', selectSchema: selector('get-deploy', { deployId: 'x' }) });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /Not found in any account: one, two/);
    } finally {
      await s.close();
    }
  });

  it('keeps a 404 as a failure for a list read, where it is not expected', async () => {
    const s = await session({ work: 'ok', other: 'missing' }, registryOf('work', 'other'));
    try {
      const result = await s.call({ account: 'all', selectSchema: selector('get-projects') });
      const body = JSON.parse(textOf(result)) as { accounts: Record<string, { ok: boolean; error?: string }> };
      assert.equal(body.accounts.other.ok, false);
      assert.match(JSON.stringify(body.accounts.other), /404/);
    } finally {
      await s.close();
    }
  });

  it('keeps a real auth failure visible in locate mode instead of calling it not found', async () => {
    const s = await session({ owner: 'ok', expired: 'expired' }, registryOf('owner', 'expired'));
    try {
      const result = await s.call({ account: 'all', selectSchema: selector('get-project', { siteId: 'abc' }) });
      const body = JSON.parse(textOf(result)) as { accounts: Record<string, { ok: boolean }>; notFoundIn: string[] };
      assert.equal(body.accounts.expired.ok, false);
      assert.deepEqual(body.notFoundIn, []);
    } finally {
      await s.close();
    }
  });
});
