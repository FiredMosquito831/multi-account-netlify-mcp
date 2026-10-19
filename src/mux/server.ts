import { Server } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Registry } from '../accounts/registry.js';
import { VERSION } from '../version.js';
import { NO_ACCOUNT_TOOLS, withAccountParam } from './catalog.js';
import { mapWithLimit } from './fanout.js';
import type { Multiplexer } from './multiplexer.js';
import { looksNotFound, modeFor, selectionOf, type Mode } from './policy.js';
import { resolveTargets } from './routing.js';

// Upper bound on concurrent calls when one request fans out to several accounts.
export const FANOUT_LIMIT = 4;

export interface MuxDeps {
  multiplexer: Multiplexer;
  loadRegistry: () => Promise<Registry>;
}

// ok: the account answered. miss: the account does not own the id (locate mode only). fail: it errored.
type Kind = 'ok' | 'miss' | 'fail';

interface AccountOutcome {
  account: string;
  kind: Kind;
  result?: CallToolResult;
  error?: string;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const textOf = (result: CallToolResult): string =>
  result.content.map((block) => ('text' in block && typeof block.text === 'string' ? block.text : '')).join('\n');

const errorResult = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

// A short plain-text answer such as "This site id ... do not exist." is a miss too. Longer text is
// data, so it is never read as a miss.
const resultOutcome = (account: string, result: CallToolResult, mode: Mode): AccountOutcome => {
  const text = textOf(result);
  if (mode === 'locate' && looksNotFound(text) && (result.isError === true || text.length < 200)) {
    return { account, kind: 'miss', result };
  }
  return { account, kind: result.isError === true ? 'fail' : 'ok', result };
};

const errorOutcome = (account: string, error: string, mode: Mode): AccountOutcome =>
  mode === 'locate' && looksNotFound(error) ? { account, kind: 'miss', error } : { account, kind: 'fail', error };

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
    const { operation, params } = selectionOf(childArgs);
    const mode = modeFor(operation, params);

    let targets;
    try {
      targets = resolveTargets(selector, await loadRegistry());
    } catch (error) {
      return errorResult(messageOf(error));
    }

    // Writes, and operations not in the policy table, run on one account only.
    if (targets.multi && mode === 'one') {
      const what = operation ? `"${operation}"` : 'This tool';
      return errorResult(
        `${what} runs on one account only, because it can change data or is not classified yet. ` +
          `Name one account, for example account: "${targets.accounts[0]}".`,
      );
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
        return resultOutcome(account, await multiplexer.callOn(account, name, childArgs), mode);
      } catch (error) {
        return errorOutcome(account, messageOf(error), mode);
      }
    });

    const shown = outcomes.filter((outcome) => outcome.kind !== 'miss');
    const missed = outcomes.filter((outcome) => outcome.kind === 'miss').map((outcome) => outcome.account);
    const answered = outcomes.some((outcome) => outcome.kind === 'ok');

    if (!answered && shown.length === 0) {
      return errorResult(`Not found in any account: ${missed.join(', ')}.`);
    }

    const body: Record<string, unknown> = {
      accounts: Object.fromEntries(
        shown.map((outcome) => [
          outcome.account,
          outcome.kind === 'ok'
            ? { ok: true, result: outcome.result }
            : { ok: false, ...(outcome.result ? { result: outcome.result } : { error: outcome.error }) },
        ]),
      ),
    };
    if (mode === 'locate') {
      body.notFoundIn = missed;
    }
    return {
      isError: !answered,
      content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    };
  });

  return server;
};
