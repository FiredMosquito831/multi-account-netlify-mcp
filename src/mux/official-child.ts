import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Client, type CallToolResult, type Tool } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { childIsolationDir } from '../paths.js';
import { VERSION } from '../version.js';

const require = createRequire(import.meta.url);

// Longest a single tool call may take. Covers a large project upload in deploy-site.
const TOOL_TIMEOUT_MS = 15 * 60_000;

// The official package has no exports map, so its package.json and dist entry resolve directly.
export const officialEntry = (): string => {
  const packageJsonPath = require.resolve('@netlify/mcp/package.json');
  return path.join(path.dirname(packageJsonPath), 'dist', 'netlify-mcp.js');
};

// Environment for one official child. The token, when given, is what the official server reads
// first. The isolation folder replaces APPDATA and HOME, so the child never reads the user's own
// Netlify CLI login, and with a token set it never starts `netlify login` on its own.
export const childEnv = (isolationDir: string, token?: string): Record<string, string> => {
  const env: Record<string, string> = {
    APPDATA: isolationDir,
    LOCALAPPDATA: isolationDir,
    XDG_CONFIG_HOME: isolationDir,
    HOME: isolationDir,
    USERPROFILE: isolationDir,
  };
  if (token) {
    env.NETLIFY_PERSONAL_ACCESS_TOKEN = token;
  }
  return env;
};

// One official @netlify/mcp process, speaking MCP to us over stdio.
export class OfficialChild {
  readonly #client: Client;
  readonly #transport: StdioClientTransport;
  #closed = false;

  private constructor(client: Client, transport: StdioClientTransport) {
    this.#client = client;
    this.#transport = transport;
  }

  static async start(id: string, token?: string): Promise<OfficialChild> {
    const isolationDir = childIsolationDir(id);
    await mkdir(isolationDir, { recursive: true });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [officialEntry()],
      env: childEnv(isolationDir, token),
    });
    const client = new Client({ name: 'multi-account-netlify-mcp', version: VERSION }, { capabilities: {} });
    const child = new OfficialChild(client, transport);
    await client.connect(transport);
    return child;
  }

  get closed(): boolean {
    return this.#closed;
  }

  // Calls `onExit` once when the child process goes away, so the caller can start a new one later.
  onExit(callback: () => void): void {
    this.#client.onclose = () => {
      this.#closed = true;
      callback();
    };
  }

  async listTools(): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.#client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  // The SDK default is 60 seconds, which a large deploy-site upload can exceed while the deploy itself
  // is still fine. Calls get this longer limit instead.
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.#client.callTool({ name, arguments: args }, { timeout: TOOL_TIMEOUT_MS }) as Promise<CallToolResult>;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#client.close();
  }
}
