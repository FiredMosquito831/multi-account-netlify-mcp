#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { accountLines } from './mux/account-tools.js';
import { addAccountInChat, storeNewAccount } from './accounts/add-account.js';
import { assertValidName, findAccount, loadRegistry, removeAccount, saveRegistry, setDefaultAccount } from './accounts/registry.js';
import { parseScope } from './install/claude-plugin.js';
import { isPresent, runCommand } from './agents/command.js';
import { ADAPTERS, runAction, type Action } from './agents/dispatch.js';
import { commandLine, completeAnswers, formatSteps, parseInstallArgs, type Answers } from './agents/install-flow.js';
import { AGENTS, type AgentScope, type Context, type Step } from './agents/types.js';
import { osTokenStore } from './secrets/token-store.js';
import { fetchNetlifyUser } from './netlify/api.js';
import { loginInChat, loginWithNetlifyCli, netlifyCliEntry } from './login/netlify-cli-login.js';
import { Multiplexer } from './mux/multiplexer.js';
import { createMuxServer } from './mux/server.js';
import { officialEntry } from './mux/official-child.js';
import { accountsFile, dataDir, packageRoot } from './paths.js';
import { USAGE, commandWhenNone } from './usage.js';

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
  if (findAccount(await loadRegistry(file), name)) {
    throw new Error(`An account named "${name}" already exists. Remove it first to replace it.`);
  }

  const token = usePat
    ? await promptHidden('Paste a Netlify personal access token (input is hidden): ')
    : (await loginWithNetlifyCli(name)).token;
  if (!token) {
    throw new Error('No token was given.');
  }

  // The token is checked before anything is stored. storeNewAccount does the check and the save.
  const { account, isDefault } = await storeNewAccount(
    { file, tokens: osTokenStore, fetchUser: fetchNetlifyUser },
    name,
    token,
    usePat ? 'pat' : 'login',
  );
  const defaultNote = isDefault ? ' It is the default account.' : '';
  console.log(`Added "${name}" (${account.email}).${defaultNote}`);
};

const runList = async (): Promise<void> => {
  const registry = await loadRegistry(accountsFile());
  for (const line of accountLines(registry)) {
    console.log(line);
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
  // One set per server: a second account_add for a name waits while the first login for it is running.
  const pending = new Set<string>();
  const addAccount = (name: string) =>
    addAccountInChat(
      { file: accountsFile(), tokens: osTokenStore, fetchUser: fetchNetlifyUser, login: loginInChat, pending },
      name,
    );
  serveStdio(() => createMuxServer({ multiplexer, loadRegistry: loadRegistryFromDisk, addAccount }));

  // Routing reads accounts.json on every call. A child that is already running keeps the token it
  // was started with, so a re-added token takes effect after a restart.
  const shutdown = () => {
    void multiplexer.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

const main = async (): Promise<void> => {
  const [given, ...rest] = process.argv.slice(2);
  const command = given ?? commandWhenNone(Boolean(process.stdin.isTTY));
  switch (command) {
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
