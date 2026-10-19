import { GITHUB_SOURCE, installPlugin, listInstalls, uninstallPlugin, updatePlugin, type ClaudeRunner } from '../install/claude-plugin.js';
import { step, type AgentAdapter, type AgentScope, type Context, type Step } from './types.js';

// Claude Code keeps its own record of plugin installs, so this adapter does not need one. It drives the
// claude plugin commands for the three scopes (global is Claude Code's user scope).
const runnerFor = (ctx: Context): ClaudeRunner => (args, options) => ctx.run('claude', args, options);

// The plugin starts this command from PATH, so it has to be installed globally with npm.
const SERVER_COMMAND = 'multi-account-netlify-mcp';
const NOT_ON_PATH = `${SERVER_COMMAND} is not on PATH. The Claude Code plugin starts it from PATH: run npm install -g multi-account-netlify-mcp`;

const sourceFor = (ctx: Context, scope: AgentScope): string =>
  ctx.claudeSource ?? (scope === 'global' ? ctx.packageRoot : GITHUB_SOURCE);

const notInstalled = (error: unknown): boolean => error instanceof Error && /is not installed/.test(error.message);

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  scopes: ['global', 'project', 'local'],

  present: (ctx) => ctx.present('claude'),

  async install(ctx, scope) {
    if (!ctx.present('claude')) {
      return [step('claude', 'install', 'skipped', 'claude is not on PATH')];
    }
    const steps: Step[] = [];
    if (!ctx.present(SERVER_COMMAND)) {
      steps.push(step('claude', 'install', 'warning', NOT_ON_PATH));
    }
    try {
      await installPlugin({
        scope,
        source: sourceFor(ctx, scope),
        projectDir: ctx.projectDir,
        run: runnerFor(ctx),
        log: (line) => steps.push(step('claude', 'install', 'ok', line)),
      });
    } catch (error) {
      return [step('claude', 'install', 'error', (error as Error).message)];
    }
    return steps;
  },

  async update(ctx, scope) {
    if (!ctx.present('claude')) {
      return [step('claude', 'update', 'skipped', 'claude is not on PATH')];
    }
    try {
      const updated = await updatePlugin({ scope, projectDir: ctx.projectDir, run: runnerFor(ctx) });
      return updated.map((where) => step('claude', 'update', 'ok', `refreshed (${where})`));
    } catch (error) {
      return notInstalled(error)
        ? [step('claude', 'update', 'skipped', (error as Error).message)]
        : [step('claude', 'update', 'error', (error as Error).message)];
    }
  },

  async uninstall(ctx, scope) {
    if (!ctx.present('claude')) {
      return [step('claude', 'uninstall', 'skipped', 'claude is not on PATH')];
    }
    try {
      const removed = await uninstallPlugin({ scope, projectDir: ctx.projectDir, run: runnerFor(ctx) });
      return removed.map((where) => step('claude', 'uninstall', 'ok', `removed (${where})`));
    } catch (error) {
      return notInstalled(error)
        ? [step('claude', 'uninstall', 'skipped', (error as Error).message)]
        : [step('claude', 'uninstall', 'error', (error as Error).message)];
    }
  },

  async doctor(ctx) {
    if (!ctx.present('claude')) {
      return [step('claude', 'plugin', 'skipped', 'claude is not on PATH')];
    }
    const onPath = ctx.present(SERVER_COMMAND) ? [] : [step('claude', 'plugin', 'warning', NOT_ON_PATH)];
    try {
      const installs = await listInstalls(runnerFor(ctx));
      if (installs.length === 0) {
        return [...onPath, step('claude', 'plugin', 'skipped', 'not installed in any scope')];
      }
      return [
        ...onPath,
        ...installs.map((install) =>
          step(
            'claude',
            'plugin',
            install.scope === 'global' || install.enabled ? 'ok' : 'warning',
            `${install.scope}${install.projectPath ? ` at ${install.projectPath}` : ''}: ${install.enabled ? 'enabled' : 'disabled'}`,
          ),
        ),
      ];
    } catch (error) {
      return [...onPath, step('claude', 'plugin', 'error', (error as Error).message)];
    }
  },
};
