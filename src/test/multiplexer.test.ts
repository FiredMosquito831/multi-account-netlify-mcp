import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { Multiplexer, type ChildStarter } from '../mux/multiplexer.js';
import type { OfficialChild } from '../mux/official-child.js';
import type { TokenStore } from '../secrets/token-store.js';

interface Call {
  child: string;
  tool: string;
  args: Record<string, unknown>;
}

const TOOLS: Tool[] = [{ name: 'netlify-project-services-reader', inputSchema: { type: 'object' } }];

const memoryTokens = (entries: Record<string, string>): TokenStore => {
  const store = new Map(Object.entries(entries));
  return {
    get: (account) => store.get(account) ?? null,
    set: (account, token) => void store.set(account, token),
    delete: (account) => store.delete(account),
  };
};

// Stands in for OfficialChild. `exit()` simulates the process going away.
const fakeStarter = () => {
  const calls: Call[] = [];
  const started: { id: string; token?: string; child: FakeChild }[] = [];
  let catalogReads = 0;

  class FakeChild {
    closed = false;
    #onExit?: () => void;
    constructor(readonly id: string) {}
    onExit(callback: () => void) {
      this.#onExit = callback;
    }
    async listTools() {
      catalogReads += 1;
      return TOOLS;
    }
    async callTool(tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
      calls.push({ child: this.id, tool, args });
      return { content: [{ type: 'text', text: `${this.id}:${tool}` }] };
    }
    async close() {
      this.closed = true;
    }
    exit() {
      this.closed = true;
      this.#onExit?.();
    }
  }

  const start: ChildStarter = async (id, token) => {
    const child = new FakeChild(id);
    started.push({ id, token, child });
    return child as unknown as OfficialChild;
  };

  return { start, calls, started, catalogReads: () => catalogReads };
};

describe('Multiplexer', () => {
  it('reads the tool list once from a child that has no account', async () => {
    const fake = fakeStarter();
    const multiplexer = new Multiplexer(memoryTokens({}), fake.start);

    assert.deepEqual(await multiplexer.tools(), TOOLS);
    assert.deepEqual(await multiplexer.tools(), TOOLS);
    assert.equal(fake.catalogReads(), 1);
    assert.deepEqual(fake.started.map((entry) => entry.token), [undefined]);
  });

  it('starts one child per account with that account\'s token, and reuses it', async () => {
    const fake = fakeStarter();
    const multiplexer = new Multiplexer(memoryTokens({ work: 'nfp_work', personal: 'nfp_personal' }), fake.start);

    await multiplexer.callOn('work', 'tool-a', { x: 1 });
    await multiplexer.callOn('work', 'tool-b', {});
    await multiplexer.callOn('personal', 'tool-a', {});

    const accountStarts = fake.started.filter((entry) => entry.id !== '_catalog');
    assert.deepEqual(
      accountStarts.map((entry) => [entry.id, entry.token]),
      [
        ['work', 'nfp_work'],
        ['personal', 'nfp_personal'],
      ],
    );
    assert.deepEqual(fake.calls.map((call) => call.child), ['work', 'work', 'personal']);
  });

  it('fails with the command to fix it when an account has no stored token', async () => {
    const multiplexer = new Multiplexer(memoryTokens({}), fakeStarter().start);
    await assert.rejects(multiplexer.callOn('ghost', 'tool', {}), /No stored token for account "ghost"[\s\S]*add ghost/);
  });

  it('starts a fresh child on the next call after the old one exits', async () => {
    const fake = fakeStarter();
    const multiplexer = new Multiplexer(memoryTokens({ work: 'nfp_work' }), fake.start);

    await multiplexer.callOn('work', 'tool', {});
    const first = fake.started.find((entry) => entry.id === 'work')!.child;
    first.exit();
    await multiplexer.callOn('work', 'tool', {});

    assert.equal(fake.started.filter((entry) => entry.id === 'work').length, 2);
  });

  it('starts the neutral child without a token', async () => {
    const fake = fakeStarter();
    const multiplexer = new Multiplexer(memoryTokens({ work: 'nfp_work' }), fake.start);

    await multiplexer.callNeutral('netlify-coding-rules', { creationType: 'netlify-access-control' });

    assert.deepEqual(fake.started.map((entry) => [entry.id, entry.token]), [['_neutral', undefined]]);
  });

  it('closes every started child on close()', async () => {
    const fake = fakeStarter();
    const multiplexer = new Multiplexer(memoryTokens({ work: 'nfp_work', personal: 'nfp_personal' }), fake.start);
    await multiplexer.callOn('work', 'tool', {});
    await multiplexer.callOn('personal', 'tool', {});

    await multiplexer.close();

    assert.deepEqual(fake.started.map((entry) => entry.child.closed), [true, true]);
  });
});
