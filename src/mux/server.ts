import { Server } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Registry } from '../accounts/registry.js';
import { VERSION } from '../version.js';
import { NO_ACCOUNT_TOOLS, withAccountParam } from './catalog.js';
import { mapWithLimit } from './fanout.js';
import type { Multiplexer } from './multiplexer.js';
import { resolveTargets } from './routing.js';

// Upper bound on concurrent calls when one request fans out to several accounts.
export const FANOUT_LIMIT = 4;

export interface MuxDeps {
  multiplexer: Multiplexer;
  loadRegistry: () => Promise<Registry>;
}

interface AccountOutcome {
  account: string;
  ok: boolean;
  result?: CallToolResult;
  error?: string;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const errorResult = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

// The MCP server that Claude Code talks to. It exposes the official tools with an `account` argument added.
export const createMuxServer = ({ multiplexer, loadRegistry }: MuxDeps): Server => {
  const server = new Server({ name: 'multi-account-netlify-mcp', version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler('tools/list', async () => {
    const [tools, registry] = await Promise.all([multiplexer.tools(), loadRegistry()]);
    const names = registry.accounts.map((account) => account.name);
    return { tools: tools.map((tool) => withAccountParam(tool, names)) };
  });

  server.setRequestHandler('tools/call', async (request) => {
    const name = request.params.name;
    const args: Record<string, unknown> = { ...(request.params.arguments ?? {}) };

    const tools = await multiplexer.tools();
    if (!tools.some((tool) => tool.name === name)) {
      return errorResult(`Unknown tool "${name}".`);
    }
    if (NO_ACCOUNT_TOOLS.has(name)) {
      return multiplexer.callNeutral(name, args);
    }

    const { account: selector, ...childArgs } = args;
    let targets;
    try {
      targets = resolveTargets(selector, await loadRegistry());
    } catch (error) {
      return errorResult(messageOf(error));
    }

    // One account: the official result is passed through unchanged.
    if (!targets.multi) {
      try {
        return await multiplexer.callOn(targets.accounts[0], name, childArgs);
      } catch (error) {
        return errorResult(messageOf(error));
      }
    }

    // Several accounts: each one runs on its own, and one failure does not stop the others.
    const outcomes = await mapWithLimit(targets.accounts, FANOUT_LIMIT, async (account): Promise<AccountOutcome> => {
      try {
        const result = await multiplexer.callOn(account, name, childArgs);
        return { account, ok: result.isError !== true, result };
      } catch (error) {
        return { account, ok: false, error: messageOf(error) };
      }
    });

    const byAccount = Object.fromEntries(
      outcomes.map((outcome) => [
        outcome.account,
        outcome.result ? { ok: outcome.ok, result: outcome.result } : { ok: false, error: outcome.error },
      ]),
    );
    return {
      isError: outcomes.every((outcome) => !outcome.ok),
      content: [{ type: 'text', text: JSON.stringify({ accounts: byAccount }, null, 2) }],
    };
  });

  return server;
};
