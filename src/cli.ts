#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  addAccount as addAccountRecord,
  assertValidName,
  findAccount,
  loadRegistry,
  removeAccount,
  saveRegistry,
  setDefaultAccount,
} from './accounts/registry.js';
import { parseScope } from './install/claude-plugin.js';
import { isPresent, runCommand } from './agents/command.js';
import { ADAPTERS, runAction, type Action } from './agents/dispatch.js';
import { commandLine, completeAnswers, formatSteps, parseInstallArgs, type Answers } from './agents/install-flow.js';
import { AGENTS, type AgentScope, type Context, type Step } from './agents/types.js';
import { osTokenStore } from './secrets/token-store.js';
import { fetchNetlifyUser } from './netlify/api.js';
import { loginWithNetlifyCli, netlifyCliEntry } from './login/netlify-cli-login.js';
import { Multiplexer } from './mux/multiplexer.js';
import { createMuxServer } from './mux/server.js';
import { officialEntry } from './mux/official-child.js';
import { accountsFile, dataDir, packageRoot } from './paths.js';

const USAGE = `multi-account-netlify-mcp <command>

Commands:
  add <name> [--pat]   Add a Netlify account. Runs \`netlify login\` in a separate profile,
                       or asks for a personal access token with --pat.
  list                 Show the accounts. Tokens are never printed.
  default <name>       Set the account used when a tool call names none.
  remove <name>        Remove an account and its stored token.
  doctor               Check the data folder, the official server, the agents and each account's token.
  install [agent ...] [--scope global|project|local] [--project-dir DIR] [--source SRC] [--dry-run] [--yes]
                       Install into the agents you name: claude, codex, opencode, antigravity, or all.
                       With no agent named, every agent set up here. In a terminal, missing answers are asked
                       for, and the exact command is shown before anything is written.
                       global (default) is for every folder. project is shared through git. local is this folder only.
  update [agent ...] [--scope global|project|local|all] [--project-dir DIR]
                       Refresh the installs that exist (default: all scopes). Run
                       \`npm install -g multi-account-netlify-mcp@latest\` first to update the code.
  uninstall [agent ...] [--scope global|project|local|all] [--project-dir DIR]
                       Remove this server from the agents (default: all scopes). Accounts and tokens are kept.
  serve                Run the MCP server over stdio. This is the default with no command.
`;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Asks for a secret without echoing it. Falls back to plain reading when stdin is not a terminal.
const promptHidden = (question: string): Promise<string> =>
  new Promise((resolve) => {
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output: muted,
      terminal: process.stdin.isTTY ?? false,
    });
    process.stdout.write(question);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });

const runAdd = async (name: string, usePat: boolean): Promise<void> => {
  assertValidName(name);
  const file = accountsFile();
  const registry = await loadRegistry(file);
  if (findAccount(registry, name)) {
    throw new Error(`An account named "${name}" already exists. Remove it first to replace it.`);
  }

  const token = usePat
    ? await promptHidden('Paste a Netlify personal access token (input is hidden): ')
    : (await loginWithNetlifyCli(name)).token;
  if (!token) {
    throw new Error('No token was given.');
  }

  // Check the token before anything is stored. The same call tells us whose account it is.
  const user = await fetchNetlifyUser(token);
  const updated = addAccountRecord(registry, {
    name,
    email: user.email,
    userId: user.id,
    source: usePat ? 'pat' : 'login',
    addedAt: new Date().toISOString(),
  });

  osTokenStore.set(name, token);
  try {
    await saveRegistry(file, updated);
  } catch (error) {
    osTokenStore.delete(name);
    throw error;
  }

  const isDefault = updated.default === name ? ' It is the default account.' : '';
  console.log(`Added "${name}" (${user.email}).${isDefault}`);
};

const runList = async (): Promise<void> => {
  const registry = await loadRegistry(accountsFile());
  if (registry.accounts.length === 0) {
    console.log('No accounts yet. Add one with: multi-account-netlify-mcp add <name>');
    return;
  }
  for (const account of registry.accounts) {
    const marker = account.name === registry.default ? '*' : ' ';
    console.log(`${marker} ${account.name}\t${account.email}\t${account.source}`);
  }
  if (!registry.default) {
    console.log('No default account. Calls must name one, or use "all".');
  }
};

const runDefault = async (name: string): Promise<void> => {
  const file = accountsFile();
  const registry = setDefaultAccount(await loadRegistry(file), name);
  await saveRegistry(file, registry);
  console.log(`Default account: ${name}`);
};

const runRemove = async (name: string): Promise<void> => {
  const file = accountsFile();
  const registry = removeAccount(await loadRegistry(file), name);
  await saveRegistry(file, registry);
  osTokenStore.delete(name);
  console.log(`Removed "${name}".`);
};

// The running CLI. The agents' server entries launch this same installed copy.
const cliPath = (): string => fileURLToPath(import.meta.url);

const makeContext = (projectDir: string | undefined, claudeSource: string | undefined): Context => ({
  home: os.homedir(),
  codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  projectDir: projectDir ?? process.cwd(),
  cliPath: cliPath(),
  packageRoot: packageRoot(),
  claudeSource,
  run: runCommand,
  present: isPresent,
});

const flagValue = (rest: string[], flag: string): string | undefined => {
  const index = rest.indexOf(flag);
  return index >= 0 ? rest[index + 1] : undefined;
};

const printSteps = (steps: Step[]): void => {
  for (const line of formatSteps(steps)) {
    console.log(line);
  }
};

const exitCodeFor = (steps: Step[]): number => (steps.some((item) => item.status === 'error') ? 1 : 0);

// What would happen, without writing anything. Each agent is listed with the scope it would get.
const planLines = (agents: string[], scope: AgentScope | 'all', ctx: Context): string[] => {
  const names = agents.includes('all') ? AGENTS.filter((id) => ADAPTERS[id].present(ctx)) : (agents as typeof AGENTS[number][]);
  return names.map((id) => {
    const adapter = ADAPTERS[id];
    const wanted = scope === 'all' ? [...adapter.scopes] : [scope];
    const supported = wanted.filter((item) => adapter.scopes.includes(item));
    const skipped = wanted.filter((item) => !adapter.scopes.includes(item));
    const parts = [`${id}: ${supported.join(', ') || 'nothing'}`];
    if (skipped.length > 0) {
      parts.push(`skipped (${skipped.join(', ')} not supported)`);
    }
    return parts.join('; ');
  });
};

const runInstall = async (rest: string[]): Promise<void> => {
  const args = parseInstallArgs(rest);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const ctx = makeContext(args.projectDir, args.source);
  const given: Answers = {
    agents: args.agents.length > 0 ? args.agents : undefined,
    scope: args.scope === undefined ? undefined : (parseScope(args.scope, 'global') as AgentScope),
    projectDir: args.projectDir,
  };

  let answers: { agents: string[]; scope: AgentScope; projectDir?: string } = {
    agents: given.agents ?? ['all'],
    scope: given.scope ?? 'global',
    projectDir: given.projectDir,
  };
  if (interactive && (given.agents === undefined || given.scope === undefined)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (question: string) => new Promise<string>((resolve) => rl.question(question, resolve));
    try {
      answers = await completeAnswers(given, ctx, ask, console.log);
    } finally {
      rl.close();
    }
  }

  const folderArg = answers.scope !== 'global' ? answers.projectDir : undefined;
  const ctxForRun = makeContext(answers.projectDir ?? args.projectDir, args.source);
  console.log(`Plan: ${planLines(answers.agents, answers.scope, ctxForRun).join(' | ')}`);
  console.log(`Command: ${commandLine({ agents: answers.agents, scope: answers.scope, projectDir: folderArg })}`);

  if (args.dryRun) {
    console.log('Dry run: nothing was changed.');
    return;
  }
  if (interactive && !args.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => rl.question('Run it? [y/N] ', resolve));
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Nothing was changed.');
      return;
    }
  }

  const steps = await runAction('install', { agents: answers.agents, scope: answers.scope }, ctxForRun);
  printSteps(steps);
  process.exitCode = exitCodeFor(steps);
};

const runScoped = async (action: Extract<Action, 'update' | 'uninstall'>, rest: string[]): Promise<void> => {
  const args = parseInstallArgs(rest);
  const scope = parseScope(args.scope, 'all');
  const ctx = makeContext(args.projectDir, undefined);
  const steps = await runAction(action, { agents: args.agents, scope }, ctx);
  printSteps(steps);
  process.exitCode = exitCodeFor(steps);
};

const runDoctor = async (): Promise<void> => {
  console.log(`Data folder: ${dataDir()}`);
  console.log(`Node: ${process.version}`);
  for (const [label, resolve] of [
    ['Official server', officialEntry],
    ['Netlify CLI (login only)', netlifyCliEntry],
  ] as const) {
    try {
      console.log(`${label}: ${resolve()}`);
    } catch (error) {
      console.log(`${label}: NOT FOUND (${messageOf(error)})`);
    }
  }

  console.log('Agents:');
  printSteps(await runAction('doctor', {}, makeContext(undefined, undefined)));

  const registry = await loadRegistry(accountsFile());
  if (registry.accounts.length === 0) {
    console.log('Accounts: none');
    return;
  }
  for (const account of registry.accounts) {
    const token = osTokenStore.get(account.name);
    if (!token) {
      console.log(`${account.name}: NO TOKEN in the credential store. Add it again.`);
      continue;
    }
    try {
      const user = await fetchNetlifyUser(token);
      console.log(`${account.name}: token accepted (${user.email})`);
    } catch (error) {
      console.log(`${account.name}: ${messageOf(error)}`);
    }
  }
};

const runServe = async (): Promise<void> => {
  const multiplexer = new Multiplexer(osTokenStore);
  const loadRegistryFromDisk = () => loadRegistry(accountsFile());
  serveStdio(() => createMuxServer({ multiplexer, loadRegistry: loadRegistryFromDisk }));

  // Routing reads accounts.json on every call. A child that is already running keeps the token it
  // was started with, so a re-added token takes effect after a restart.
  const shutdown = () => {
    void multiplexer.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case undefined:
    case 'serve':
      return runServe();
    case 'add': {
      const name = rest.find((arg) => !arg.startsWith('--'));
      if (!name) {
        throw new Error('Usage: multi-account-netlify-mcp add <name> [--pat]');
      }
      return runAdd(name, rest.includes('--pat'));
    }
    case 'list':
      return runList();
    case 'default': {
      const name = rest[0];
      if (!name) {
        throw new Error('Usage: multi-account-netlify-mcp default <name>');
      }
      return runDefault(name);
    }
    case 'remove': {
      const name = rest[0];
      if (!name) {
        throw new Error('Usage: multi-account-netlify-mcp remove <name>');
      }
      return runRemove(name);
    }
    case 'doctor':
      return runDoctor();
    case 'install':
      return runInstall(rest);
    case 'update':
      return runScoped('update', rest);
    case 'uninstall':
      return runScoped('uninstall', rest);
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return;
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
};

main().catch((error: unknown) => {
  // Errors go to stderr. In serve mode stdout is the MCP channel and must stay clean.
  console.error(`Error: ${messageOf(error)}`);
  process.exitCode = 1;
});
