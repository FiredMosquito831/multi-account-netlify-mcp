#!/usr/bin/env node
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
import {
  GITHUB_SOURCE,
  PLUGIN_ID,
  installPlugin,
  listInstalls,
  parseScope,
  sameFolder,
  uninstallPlugin,
  updatePlugin,
} from './install/claude-plugin.js';
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
  doctor               Check the data folder, the official server, the plugin and each account's token.
  install [--scope global|project|local] [--project-dir DIR] [--source SRC] [--dry-run]
                       Install the Claude Code plugin. global (default) is for every folder.
                       project is shared through the folder's .claude/settings.json.
                       local is this folder only, not shared.
  update [--scope global|project|local|all] [--project-dir DIR]
                       Refresh the plugin in the chosen scope (default all). To update the code too, run
                       \`npm install -g multi-account-netlify-mcp@latest\` first.
  uninstall [--scope global|project|local|all] [--project-dir DIR]
                       Remove the plugin from the chosen scope (default all). Accounts and tokens are kept.
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

const reportPlugin = async (): Promise<void> => {
  try {
    const installs = await listInstalls();
    if (installs.length === 0) {
      console.log(`Claude plugin ${PLUGIN_ID}: not installed. Run: multi-account-netlify-mcp install`);
    }
    for (const install of installs) {
      if (install.scope === 'global') {
        console.log(`Claude plugin ${PLUGIN_ID}: global, ${install.enabled ? 'enabled' : 'DISABLED'}`);
        continue;
      }
      // A project or local install is only active when Claude Code runs in its folder.
      const here = install.projectPath !== undefined && sameFolder(install.projectPath, process.cwd());
      const state = here ? (install.enabled ? 'enabled here' : 'DISABLED here') : 'active when Claude Code runs in that folder';
      console.log(`Claude plugin ${PLUGIN_ID}: ${install.scope} at ${install.projectPath}, ${state}`);
    }
  } catch (error) {
    console.log(`Claude plugin check: ${messageOf(error)}`);
  }
};

const runDoctor = async (): Promise<void> => {
  console.log(`Data folder: ${dataDir()}`);
  console.log(`Node: ${process.version}`);
  await reportPlugin();
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

// The running CLI. The plugin's MCP server launches this same installed copy.
const cliPath = (): string => fileURLToPath(import.meta.url);

const flagValue = (rest: string[], flag: string): string | undefined => {
  const index = rest.indexOf(flag);
  return index >= 0 ? rest[index + 1] : undefined;
};

const runInstall = async (rest: string[]): Promise<void> => {
  const scope = parseScope(flagValue(rest, '--scope'), 'global');
  if (scope === 'all') {
    throw new Error('install takes one scope: global, project or local.');
  }
  // global installs the marketplace from this package's folder, so the plugin matches the installed version.
  // project and local install from GitHub, which is safe to record in a repo.
  const source = flagValue(rest, '--source') ?? (scope === 'global' ? packageRoot() : GITHUB_SOURCE);
  const dryRun = rest.includes('--dry-run');
  await installPlugin({
    scope,
    source,
    cliPath: cliPath(),
    projectDir: flagValue(rest, '--project-dir'),
    dryRun,
    log: (line) => console.log(line),
  });
  if (dryRun) {
    console.log('Dry run: nothing was changed.');
    return;
  }
  console.log(`Installed ${PLUGIN_ID} (${scope} scope).`);
  if (scope !== 'global') {
    console.log("cli_path is this machine's path. Teammates who clone the repo run install on their own machine.");
  }
  console.log('Next: add an account with `multi-account-netlify-mcp add <name>`, then restart Claude Code.');
};

const selectionFrom = (rest: string[]) => parseScope(flagValue(rest, '--scope'), 'all');

const runUpdate = async (rest: string[]): Promise<void> => {
  const updated = await updatePlugin({ scope: selectionFrom(rest), projectDir: flagValue(rest, '--project-dir') });
  for (const where of updated) {
    console.log(`Refreshed ${PLUGIN_ID} (${where}).`);
  }
  console.log('To update the code too, run `npm install -g multi-account-netlify-mcp@latest` first, then this command. Then restart Claude Code.');
};

const runUninstall = async (rest: string[]): Promise<void> => {
  const removed = await uninstallPlugin({ scope: selectionFrom(rest), projectDir: flagValue(rest, '--project-dir') });
  for (const where of removed) {
    console.log(`Removed ${PLUGIN_ID} (${where}). Accounts and tokens are kept; \`remove <name>\` deletes one.`);
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
      return runUpdate(rest);
    case 'uninstall':
      return runUninstall(rest);
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
