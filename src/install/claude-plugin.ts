import { spawn } from 'node:child_process';
import path from 'node:path';

export const MARKETPLACE_NAME = 'multi-account-netlify-mcp';
export const PLUGIN_NAME = 'multi-account-netlify';
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
export const GITHUB_SOURCE = 'FiredMosquito831/multi-account-netlify-mcp';

// global: for this account, in every folder (Claude Code's user scope). project: shared through the repo
// (.claude/settings.json). local: this folder only, not shared.
export type Scope = 'global' | 'project' | 'local';
export type Selection = Scope | 'all';

const CLAUDE_SCOPE: Record<Scope, 'user' | 'project' | 'local'> = { global: 'user', project: 'project', local: 'local' };

// Accepts global (or its alias user), project, local, and all where the fallback allows it.
export const parseScope = (value: string | undefined, fallback: Selection): Selection => {
  if (value === undefined) {
    return fallback;
  }
  if (value === 'global' || value === 'user') {
    return 'global';
  }
  if (value === 'project' || value === 'local') {
    return value;
  }
  if (value === 'all' && fallback === 'all') {
    return 'all';
  }
  throw new Error(`--scope must be global, project or local${fallback === 'all' ? ' or all' : ''}.`);
};

export interface RunOptions {
  cwd?: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Runs the `claude` CLI with fixed arguments and no shell, so no argument is ever interpreted by a shell.
export type ClaudeRunner = (args: readonly string[], options?: RunOptions) => Promise<RunResult>;

export const runClaude: ClaudeRunner = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn('claude', [...args], { shell: false, windowsHide: true, cwd: options.cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new Error('Could not start "claude". Install Claude Code and make sure it is on PATH.')
          : error,
      );
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

const failure = (what: string, result: RunResult): Error =>
  new Error(`${what} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`);

export const sameFolder = (a: string, b: string): boolean => {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};

export interface PluginInstall {
  scope: Scope;
  enabled: boolean;
  projectPath?: string;
}

// Every install of this plugin, in every scope, from `claude plugin list --json`.
export const listInstalls = async (run: ClaudeRunner = runClaude): Promise<PluginInstall[]> => {
  const result = await run(['plugin', 'list', '--json']);
  if (result.code !== 0) {
    throw failure('`claude plugin list`', result);
  }
  const entries = JSON.parse(result.stdout) as { id?: string; scope?: string; enabled?: boolean; projectPath?: string }[];
  return entries
    .filter((entry) => entry.id === PLUGIN_ID)
    .map((entry) => ({
      scope: entry.scope === 'user' ? 'global' : (entry.scope as Scope),
      enabled: entry.enabled === true,
      projectPath: entry.projectPath,
    }));
};

const marketplaceNames = (stdout: string): string[] => {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected output from `claude plugin marketplace list --json`.');
  }
  return parsed.map((entry) => (typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name : ''));
};

export interface InstallOptions {
  scope: Scope;
  // Folder or GitHub repo that holds the marketplace. The CLI chooses the default for the scope.
  source: string;
  // Absolute path to dist/cli.js. Stored as the plugin's cli_path setting, used by .mcp.json.
  cliPath: string;
  // Folder for project and local scope. Defaults to the current folder.
  projectDir?: string;
  dryRun?: boolean;
  run?: ClaudeRunner;
  log?: (line: string) => void;
}

export interface Step {
  args: string[];
  ran: boolean;
}

// Declares the marketplace in the scope, then installs the plugin there.
// Global: added once, or refreshed if it is already registered. Project and local: declared every time,
// because each scope keeps its own record, and repeating the add is safe.
export const installPlugin = async (options: InstallOptions): Promise<Step[]> => {
  const run = options.run ?? runClaude;
  const log = options.log ?? (() => undefined);
  const cwd = options.projectDir ?? process.cwd();
  const claudeScope = CLAUDE_SCOPE[options.scope];
  const steps: Step[] = [];

  let marketplaceArgs = ['plugin', 'marketplace', 'add', options.source, '--scope', claudeScope];
  if (options.scope === 'global') {
    const list = await run(['plugin', 'marketplace', 'list', '--json'], { cwd });
    if (list.code !== 0) {
      throw failure('`claude plugin marketplace list`', list);
    }
    if (marketplaceNames(list.stdout).includes(MARKETPLACE_NAME)) {
      marketplaceArgs = ['plugin', 'marketplace', 'update', MARKETPLACE_NAME];
    }
  }
  const installArgs = ['plugin', 'install', PLUGIN_ID, '--scope', claudeScope, '--config', `cli_path=${options.cliPath}`];

  for (const args of [marketplaceArgs, installArgs]) {
    if (options.dryRun) {
      steps.push({ args, ran: false });
      log(`would run: claude ${args.join(' ')}`);
      continue;
    }
    const result = await run(args, { cwd });
    steps.push({ args, ran: true });
    const alreadyDeclared = result.code !== 0 && args[2] === 'add' && /already/i.test(`${result.stdout}${result.stderr}`);
    if (result.code !== 0 && !alreadyDeclared) {
      throw failure(`claude ${args.slice(0, 3).join(' ')}`, result);
    }
    log(`ran: claude ${args.join(' ')}`);
  }
  return steps;
};

// The installs a selection refers to. Project and local installs must be in the given folder.
const selectInstalls = (installs: PluginInstall[], selection: Selection, projectDir: string): PluginInstall[] =>
  installs.filter((install) => {
    if (selection !== 'all' && install.scope !== selection) {
      return false;
    }
    if (install.scope === 'global') {
      return true;
    }
    return install.projectPath !== undefined && sameFolder(install.projectPath, projectDir);
  });

const describeInstall = (install: PluginInstall): string =>
  install.scope === 'global' ? 'global' : `${install.scope} at ${install.projectPath}`;

const nothingInstalled = (selection: Selection): Error =>
  new Error(`${PLUGIN_ID} is not installed ${selection === 'all' ? 'in any scope' : `in the ${selection} scope`} here.`);

export interface ChangeOptions {
  scope: Selection;
  projectDir?: string;
  run?: ClaudeRunner;
  log?: (line: string) => void;
}

// Removes the plugin from the selected scopes. Accounts and tokens are kept.
export const uninstallPlugin = async (options: ChangeOptions): Promise<string[]> => {
  const run = options.run ?? runClaude;
  const log = options.log ?? (() => undefined);
  const projectDir = options.projectDir ?? process.cwd();
  const targets = selectInstalls(await listInstalls(run), options.scope, projectDir);
  if (targets.length === 0) {
    throw nothingInstalled(options.scope);
  }
  const removed: string[] = [];
  for (const install of targets) {
    const result = await run(['plugin', 'uninstall', PLUGIN_ID, '--scope', CLAUDE_SCOPE[install.scope]], {
      cwd: install.scope === 'global' ? projectDir : install.projectPath,
    });
    if (result.code !== 0) {
      throw failure(`claude plugin uninstall (${describeInstall(install)})`, result);
    }
    removed.push(describeInstall(install));
    log(`removed from ${describeInstall(install)}`);
  }
  return removed;
};

// Refreshes the marketplace once, then updates the plugin in each selected scope.
export const updatePlugin = async (options: ChangeOptions): Promise<string[]> => {
  const run = options.run ?? runClaude;
  const log = options.log ?? (() => undefined);
  const projectDir = options.projectDir ?? process.cwd();
  const targets = selectInstalls(await listInstalls(run), options.scope, projectDir);
  if (targets.length === 0) {
    throw nothingInstalled(options.scope);
  }
  const refresh = await run(['plugin', 'marketplace', 'update', MARKETPLACE_NAME], { cwd: projectDir });
  if (refresh.code !== 0) {
    throw failure('`claude plugin marketplace update`', refresh);
  }
  const updated: string[] = [];
  for (const install of targets) {
    const result = await run(['plugin', 'update', PLUGIN_ID, '--scope', CLAUDE_SCOPE[install.scope]], {
      cwd: install.scope === 'global' ? projectDir : install.projectPath,
    });
    if (result.code !== 0) {
      throw failure(`claude plugin update (${describeInstall(install)})`, result);
    }
    updated.push(describeInstall(install));
    log(`updated in ${describeInstall(install)}`);
  }
  return updated;
};
