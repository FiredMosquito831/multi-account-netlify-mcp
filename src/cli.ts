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
import { PLUGIN_ID, installPlugin, pluginStatus, uninstallPlugin, updatePlugin } from './install/claude-plugin.js';
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
  install [--scope user|project] [--dry-run] [--source <folder>]
                       Add the marketplace and install the Claude Code plugin.
  update               Refresh the plugin. Run \`npm install -g multi-account-netlify-mcp@latest\` first to update the code.
  uninstall [--scope user|project]
                       Remove the Claude Code plugin. Accounts and tokens are kept.
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
    const status = await pluginStatus();
    if (status === 'no-claude') {
      console.log('Claude Code: not found on PATH');
    } else if (!status.installed) {
      console.log(`Claude plugin ${PLUGIN_ID}: not installed. Run: multi-account-netlify-mcp install`);
    } else {
      console.log(`Claude plugin ${PLUGIN_ID}: ${status.enabled ? 'installed and enabled' : 'installed but DISABLED'}`);
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

const scopeFrom = (rest: string[]): 'user' | 'project' => {
  const index = rest.indexOf('--scope');
  const value = index >= 0 ? rest[index + 1] : 'user';
  if (value !== 'user' && value !== 'project') {
    throw new Error('--scope must be "user" or "project".');
  }
  return value;
};

const runInstall = async (rest: string[]): Promise<void> => {
  const sourceIndex = rest.indexOf('--source');
  const source = sourceIndex >= 0 && rest[sourceIndex + 1] ? rest[sourceIndex + 1] : packageRoot();
  const dryRun = rest.includes('--dry-run');
  await installPlugin({
    scope: scopeFrom(rest),
    source,
    cliPath: cliPath(),
    dryRun,
    log: (line) => console.log(line),
  });
  if (dryRun) {
    console.log('Dry run: nothing was changed.');
    return;
  }
  console.log(`Installed ${PLUGIN_ID}.`);
  console.log('Next: add an account with `multi-account-netlify-mcp add <name>`, then restart Claude Code.');
};

const runUpdate = async (rest: string[]): Promise<void> => {
  await updatePlugin({ scope: scopeFrom(rest) });
  console.log(`Refreshed ${PLUGIN_ID}.`);
  console.log('To update the code too, run `npm install -g multi-account-netlify-mcp@latest` first, then this command. Then restart Claude Code.');
};

const runUninstall = async (rest: string[]): Promise<void> => {
  await uninstallPlugin({ scope: scopeFrom(rest) });
  console.log(`Removed ${PLUGIN_ID}. Accounts and tokens are kept; \`remove <name>\` deletes one.`);
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
