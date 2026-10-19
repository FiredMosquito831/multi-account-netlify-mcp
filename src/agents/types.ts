import type { Runner } from './command.js';

export const AGENTS = ['claude', 'codex', 'opencode', 'antigravity'] as const;
export type AgentId = (typeof AGENTS)[number];

// global: for this account. project: the folder, shared through git. local: the folder only, not shared.
// Not every agent supports every scope (see each adapter's scopes).
export type AgentScope = 'global' | 'project' | 'local';

export type Status = 'ok' | 'skipped' | 'warning' | 'error';

export interface Step {
  agent: AgentId;
  action: string;
  status: Status;
  detail: string;
}

// Everything an adapter needs. Tests build one with temporary folders and a fake runner.
export interface Context {
  // Where global agent configs live (normally the user's home folder).
  home: string;
  // Codex's home folder: CODEX_HOME if it is set, otherwise ~/.codex. Its skills and config live here.
  codexHome: string;
  // The folder for project and local scopes.
  projectDir: string;
  // dist/cli.js. Every agent starts the server with `node <cliPath> serve`.
  cliPath: string;
  // The installed package folder, which holds the plugin and the skill text.
  packageRoot: string;
  // Marketplace source for Claude Code. Defaults to the package folder for global and GitHub for other scopes.
  claudeSource?: string;
  run: Runner;
  present: (command: string) => boolean;
}

export class UnsupportedScope extends Error {}

export interface AgentAdapter {
  readonly id: AgentId;
  readonly scopes: readonly AgentScope[];
  // Whether the agent is set up on this machine. Used to pick targets when none are named.
  present(ctx: Context): boolean;
  install(ctx: Context, scope: AgentScope): Promise<Step[]>;
  update(ctx: Context, scope: AgentScope): Promise<Step[]>;
  uninstall(ctx: Context, scope: AgentScope): Promise<Step[]>;
  doctor(ctx: Context): Promise<Step[]>;
}

export const SERVER_NAME = 'multi-account-netlify';

export const step = (agent: AgentId, action: string, status: Status, detail: string): Step => ({ agent, action, status, detail });
