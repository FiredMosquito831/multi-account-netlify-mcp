import { spawn } from 'node:child_process';

export const MARKETPLACE_NAME = 'multi-account-netlify-mcp';
export const PLUGIN_NAME = 'multi-account-netlify';
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Runs the `claude` CLI with fixed arguments and no shell, so no argument is ever interpreted by a shell.
export type ClaudeRunner = (args: readonly string[]) => Promise<RunResult>;

export const runClaude: ClaudeRunner = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn('claude', [...args], { shell: false, windowsHide: true });
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

const marketplaceNames = (stdout: string): string[] => {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected output from `claude plugin marketplace list --json`.');
  }
  return parsed.map((entry) => (typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name : ''));
};

export interface InstallOptions {
  scope: 'user' | 'project';
  // Folder or GitHub repo that holds the marketplace. Defaults to the installed package folder.
  source: string;
  // Absolute path to dist/cli.js. Stored as the plugin's cli_path setting, used by .mcp.json.
  cliPath: string;
  dryRun?: boolean;
  run?: ClaudeRunner;
  log?: (line: string) => void;
}

export interface Step {
  args: string[];
  ran: boolean;
}

// Registers the marketplace (or refreshes it if it is already registered), then installs the plugin.
export const installPlugin = async (options: InstallOptions): Promise<Step[]> => {
  const run = options.run ?? runClaude;
  const log = options.log ?? (() => undefined);
  const steps: Step[] = [];

  const list = await run(['plugin', 'marketplace', 'list', '--json']);
  if (list.code !== 0) {
    throw failure('`claude plugin marketplace list`', list);
  }
  const alreadyRegistered = marketplaceNames(list.stdout).includes(MARKETPLACE_NAME);

  const marketplaceArgs = alreadyRegistered
    ? ['plugin', 'marketplace', 'update', MARKETPLACE_NAME]
    : ['plugin', 'marketplace', 'add', options.source, '--scope', options.scope];
  const installArgs = ['plugin', 'install', PLUGIN_ID, '--scope', options.scope, '--config', `cli_path=${options.cliPath}`];

  for (const args of [marketplaceArgs, installArgs]) {
    if (options.dryRun) {
      steps.push({ args, ran: false });
      log(`would run: claude ${args.join(' ')}`);
      continue;
    }
    const result = await run(args);
    steps.push({ args, ran: true });
    if (result.code !== 0) {
      throw failure(`claude ${args.slice(0, 3).join(' ')}`, result);
    }
    log(`ran: claude ${args.join(' ')}`);
  }
  return steps;
};

export const updatePlugin = async (options: { scope: 'user' | 'project'; run?: ClaudeRunner }): Promise<void> => {
  const run = options.run ?? runClaude;
  const refresh = await run(['plugin', 'marketplace', 'update', MARKETPLACE_NAME]);
  if (refresh.code !== 0) {
    throw failure('`claude plugin marketplace update`', refresh);
  }
  const update = await run(['plugin', 'update', PLUGIN_ID, '--scope', options.scope]);
  if (update.code !== 0) {
    throw failure('`claude plugin update`', update);
  }
};

export const uninstallPlugin = async (options: { scope: 'user' | 'project'; run?: ClaudeRunner }): Promise<void> => {
  const run = options.run ?? runClaude;
  const result = await run(['plugin', 'uninstall', PLUGIN_ID, '--scope', options.scope]);
  if (result.code !== 0) {
    throw failure('`claude plugin uninstall`', result);
  }
};

export interface PluginStatus {
  installed: boolean;
  enabled: boolean;
  installPath?: string;
}

// Reads the plugin's state from `claude plugin list --json`. Returns installed: false when Claude is missing.
export const pluginStatus = async (run: ClaudeRunner = runClaude): Promise<PluginStatus | 'no-claude'> => {
  let result: RunResult;
  try {
    result = await run(['plugin', 'list', '--json']);
  } catch {
    return 'no-claude';
  }
  if (result.code !== 0) {
    throw failure('`claude plugin list`', result);
  }
  const entries = JSON.parse(result.stdout) as { id?: string; enabled?: boolean; installPath?: string }[];
  const entry = entries.find((item) => item.id === PLUGIN_ID);
  return entry ? { installed: true, enabled: entry.enabled === true, installPath: entry.installPath } : { installed: false, enabled: false };
};
