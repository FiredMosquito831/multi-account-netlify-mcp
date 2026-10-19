import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import type { TokenStore } from '../secrets/token-store.js';
import { OfficialChild } from './official-child.js';

// Child ids that do not belong to an account. They never receive a token.
const CATALOG_ID = '_catalog';
const NEUTRAL_ID = '_neutral';

export type ChildStarter = (id: string, token?: string) => Promise<OfficialChild>;

// Keeps one official child per account and routes calls to them.
export class Multiplexer {
  readonly #tokens: TokenStore;
  readonly #start: ChildStarter;
  readonly #children = new Map<string, Promise<OfficialChild>>();
  #catalog?: Promise<Tool[]>;

  constructor(tokens: TokenStore, start: ChildStarter = OfficialChild.start) {
    this.#tokens = tokens;
    this.#start = start;
  }

  // The official tool list, read once from a child that has no account. It is cached until restart,
  // so a newer official version shows up after `npm update` and a restart.
  tools(): Promise<Tool[]> {
    this.#catalog ??= this.#readCatalog().catch((error: unknown) => {
      this.#catalog = undefined;
      throw error;
    });
    return this.#catalog;
  }

  async callOn(account: string, tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const child = await this.#childFor(account);
    return child.callTool(tool, args);
  }

  // For tools that never call the Netlify API. No token is passed.
  async callNeutral(tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const child = await this.#start(NEUTRAL_ID);
    return child.callTool(tool, args);
  }

  async close(): Promise<void> {
    const children = [...this.#children.values()];
    this.#children.clear();
    await Promise.allSettled(children.map(async (pending) => (await pending).close()));
  }

  async #readCatalog(): Promise<Tool[]> {
    const child = await this.#start(CATALOG_ID);
    try {
      return await child.listTools();
    } finally {
      await child.close();
    }
  }

  async #childFor(account: string): Promise<OfficialChild> {
    const cached = this.#children.get(account);
    if (cached) {
      const child = await cached;
      if (!child.closed) {
        return child;
      }
    }

    const token = this.#tokens.get(account);
    if (!token) {
      throw new Error(`No stored token for account "${account}". Add it again with: multi-account-netlify-mcp add ${account}`);
    }

    const started = this.#start(account, token).then((child) => {
      child.onExit(() => {
        if (this.#children.get(account) === started) {
          this.#children.delete(account);
        }
      });
      return child;
    });
    this.#children.set(account, started);
    started.catch(() => {
      if (this.#children.get(account) === started) {
        this.#children.delete(account);
      }
    });
    return started;
  }
}
