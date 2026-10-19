#!/usr/bin/env node
// Starts the multi-account-netlify-mcp server for the Claude Code plugin.
//
// If the command is on PATH (npm install -g multi-account-netlify-mcp), it is used, so the plugin and the
// installed CLI are the same copy. Otherwise the same version is run from npm with npx, so the plugin works
// straight from the marketplace. The server speaks MCP on stdout, so this file writes only to stderr.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE = 'multi-account-netlify-mcp';

// The plugin version is the package version. The tests check that the two match.
export const pluginVersion = (pluginRoot) =>
  JSON.parse(readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;

// What to run: the installed command when it is on PATH, otherwise npx with the same version.
export const launchPlan = ({ version, onPath, windows }) => ({
  command: onPath ? PACKAGE : 'npx',
  args: onPath ? ['serve'] : ['-y', `${PACKAGE}@${version}`, 'serve'],
  shell: windows,
});

export const isOnPath = (name, windows) => spawnSync(windows ? 'where' : 'which', [name], { stdio: 'ignore' }).status === 0;

const main = () => {
  const windows = process.platform === 'win32';
  const pluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const plan = launchPlan({ version: pluginVersion(pluginRoot), onPath: isOnPath(PACKAGE, windows), windows });

  const child = spawn(plan.command, plan.args, { stdio: 'inherit', shell: plan.shell });
  child.on('error', (error) => {
    process.stderr.write(`multi-account-netlify-mcp could not start: ${error.message}. Node.js and npm must be installed.\n`);
    process.exit(1);
  });
  // Claude Code stops the server with a signal. Pass it on, so the server can close its children.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
