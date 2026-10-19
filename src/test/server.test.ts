import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client, InMemoryTransport, type CallToolResult, type Tool } from '@modelcontextprotocol/client';
import { addAccount, emptyRegistry, setDefaultAccount, type AccountRecord, type Registry } from '../accounts/registry.js';
import { createMuxServer } from '../mux/server.js';
import { Multiplexer, type ChildStarter } from '../mux/multiplexer.js';
import type { OfficialChild } from '../mux/official-child.js';
import type { TokenStore } from '../secrets/token-store.js';

const TOOLS: Tool[] = [
  { name: 'netlify-project-services-reader', inputSchema: { type: 'object', properties: { selectSchema: { type: 'object' } } } },
  { name: 'netlify-coding-rules', inputSchema: { type: 'object', properties: { creationType: { type: 'string' } } } },
];

const account = (name: string): AccountRecord => ({
  name,
  email: `${name}@example.com`,
  userId: `user-${name}`,
  source: 'login',
  addedAt: '2026-10-19T00:00:00.000Z',
});

const registryOf = (...names: string[]): Registry => names.reduce((r, name) => addAccount(r, account(name)), emptyRegistry());

// Child behaviour: the token "expired" returns an MCP error result, "broken" throws, anything else succeeds.
const scriptedStarter = (calls: { child: string; tool: string; args: Record<string, unknown> }[]): ChildStarter =>
  async (id, token) =>
    ({
      closed: false,
      onExit() {},
      async listTools() {
        return TOOLS;
      },
      async callTool(tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
        calls.push({ child: id, tool, args });
        if (token === 'broken') {
          throw new Error('Failed to fetch API: 503');
        }
        if (token === 'expired') {
          return { isError: true, content: [{ type: 'text', text: 'Netlify rejected the token' }] };
        }
        return { content: [{ type: 'text', text: `${id}:${tool}` }] };
      },
      async close() {},
    }) as unknown as OfficialChild;

const tokensFor = (entries: Record<string, string>): TokenStore => ({
  get: (name) => entries[name] ?? null,
  set() {},
  delete: () => true,
});

const connect = async (registry: Registry, tokens: Record<string, string>) => {
  const calls: { child: string; tool: string; args: Record<string, unknown> }[] = [];
  const multiplexer = new Multiplexer(tokensFor(tokens), scriptedStarter(calls));
  const server = createMuxServer({ multiplexer, loadRegistry: async () => registry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return {
    client,
    calls,
    close: async () => {
      await client.close();
      await multiplexer.close();
    },
  };
};

const textOf = (result: CallToolResult): string => (result.content[0] as { text: string }).text;

describe('mux server', () => {
  it('lists the official tools with an account argument, except the coding-rules tool', async () => {
    const session = await connect(registryOf('work'), { work: 'nfp_ok' });
    try {
      const { tools } = await session.client.listTools();
      const domain = tools.find((tool) => tool.name === 'netlify-project-services-reader')!;
      const rules = tools.find((tool) => tool.name === 'netlify-coding-rules')!;
      assert.ok((domain.inputSchema.properties as Record<string, unknown>).account);
      assert.equal((rules.inputSchema.properties as Record<string, unknown>).account, undefined);
    } finally {
      await session.close();
    }
  });

  it('passes a single-account result through unchanged and hides the account argument from the child', async () => {
    const session = await connect(registryOf('work', 'personal'), { work: 'nfp_ok', personal: 'nfp_ok' });
    try {
      const result = await session.client.callTool({
        name: 'netlify-project-services-reader',
        arguments: { account: 'personal', selectSchema: { operation: 'get-project' } },
      });
      assert.equal(textOf(result as CallToolResult), 'personal:netlify-project-services-reader');
      assert.deepEqual(session.calls[0].args, { selectSchema: { operation: 'get-project' } });
    } finally {
      await session.close();
    }
  });

  it('answers "all" with one entry per account, and one failing account does not hide the others', async () => {
    const session = await connect(registryOf('work', 'broken-one'), { work: 'nfp_ok', 'broken-one': 'broken' });
    try {
      const result = (await session.client.callTool({
        name: 'netlify-project-services-reader',
        arguments: { account: 'all' },
      })) as CallToolResult;
      const body = JSON.parse(textOf(result)) as { accounts: Record<string, { ok: boolean; error?: string }> };
      assert.notEqual(result.isError, true);
      assert.equal(body.accounts.work.ok, true);
      assert.equal(body.accounts['broken-one'].ok, false);
      assert.match(body.accounts['broken-one'].error!, /503/);
    } finally {
      await session.close();
    }
  });

  it('marks an "all" call as an error only when every account fails', async () => {
    const session = await connect(registryOf('one', 'two'), { one: 'expired', two: 'expired' });
    try {
      const result = (await session.client.callTool({
        name: 'netlify-project-services-reader',
        arguments: { account: 'one,two' },
      })) as CallToolResult;
      assert.equal(result.isError, true);
      const body = JSON.parse(textOf(result)) as { accounts: Record<string, { ok: boolean; result: CallToolResult }> };
      assert.equal(body.accounts.one.ok, false);
      assert.match(textOf(body.accounts.one.result), /rejected the token/);
    } finally {
      await session.close();
    }
  });

  it('asks for an account when several exist and no default is set', async () => {
    const registry = { ...registryOf('work', 'personal'), default: undefined };
    const session = await connect(registry, { work: 'nfp_ok', personal: 'nfp_ok' });
    try {
      const result = (await session.client.callTool({
        name: 'netlify-project-services-reader',
        arguments: {},
      })) as CallToolResult;
      assert.equal(result.isError, true);
      assert.match(textOf(result), /No default account is set/);
      assert.equal(session.calls.length, 0);
    } finally {
      await session.close();
    }
  });

  it('uses the default account when the argument is left out', async () => {
    const registry = setDefaultAccount(registryOf('work', 'personal'), 'personal');
    const session = await connect(registry, { work: 'nfp_ok', personal: 'nfp_ok' });
    try {
      const result = (await session.client.callTool({
        name: 'netlify-project-services-reader',
        arguments: {},
      })) as CallToolResult;
      assert.equal(textOf(result), 'personal:netlify-project-services-reader');
    } finally {
      await session.close();
    }
  });

  it('reports unknown accounts and unknown tools as errors without calling anything', async () => {
    const session = await connect(registryOf('work'), { work: 'nfp_ok' });
    try {
      const unknownAccount = (await session.client.callTool({
        name: 'netlify-project-services-reader',
        arguments: { account: 'ghost' },
      })) as CallToolResult;
      assert.equal(unknownAccount.isError, true);
      assert.match(textOf(unknownAccount), /Unknown account: ghost/);

      const unknownTool = (await session.client.callTool({ name: 'no-such-tool', arguments: {} })) as CallToolResult;
      assert.equal(unknownTool.isError, true);
      assert.match(textOf(unknownTool), /Unknown tool "no-such-tool"/);
      assert.equal(session.calls.length, 0);
    } finally {
      await session.close();
    }
  });

  it('routes the coding-rules tool to the neutral child and gives it no account', async () => {
    const session = await connect(registryOf('work'), { work: 'nfp_ok' });
    try {
      const result = (await session.client.callTool({
        name: 'netlify-coding-rules',
        arguments: { creationType: 'netlify-access-control' },
      })) as CallToolResult;
      assert.equal(textOf(result), '_neutral:netlify-coding-rules');
      assert.deepEqual(session.calls[0], {
        child: '_neutral',
        tool: 'netlify-coding-rules',
        args: { creationType: 'netlify-access-control' },
      });
    } finally {
      await session.close();
    }
  });
});
