import { forget, record, recordedItems, scopeKey } from './state.js';
import { SERVER_NAME, step, UnsupportedScope, type AgentAdapter, type Context, type Step } from './types.js';

// Google Antigravity (agy). It has no project scope, and it registers servers through `agy mcp`.
// Its skills come from a plugin, and the plugin's server needs the cli_path setting, which
// `agy plugin install` cannot set yet. So only the server is installed here.
const SKILL_NOTE =
  'not installed: Antigravity gets skills through a plugin, and the plugin needs its cli_path setting, which agy plugin install cannot set yet';

export const antigravityAdapter: AgentAdapter = {
  id: 'antigravity',
  scopes: ['global'],

  present: (ctx) => ctx.present('agy'),

  async install(ctx: Context, scope) {
    if (scope !== 'global') {
      throw new UnsupportedScope('Antigravity has no project scope. Use global.');
    }
    if (!ctx.present('agy')) {
      return [step('antigravity', 'install', 'skipped', 'agy is not on PATH')];
    }
    const added = await ctx.run('agy', ['mcp', 'add', SERVER_NAME, '--', process.execPath, ctx.cliPath, 'serve']);
    if (added.code !== 0) {
      return [step('antigravity', 'install', 'error', added.stderr.trim() || added.stdout.trim() || `exit ${added.code}`)];
    }
    await record('antigravity', scopeKey('global', ctx.projectDir), { kind: 'mcp-entry', path: 'agy mcp', name: SERVER_NAME });
    return [
      step('antigravity', 'mcp add', 'ok', `added with agy mcp add (${SERVER_NAME})`),
      step('antigravity', 'skill', 'skipped', SKILL_NOTE),
    ];
  },

  // Refreshes only an existing install. Update never adds one.
  async update(ctx, scope) {
    return recordedItems('antigravity', scopeKey('global', ctx.projectDir)).length > 0
      ? this.install(ctx, scope)
      : [step('antigravity', 'update', 'skipped', 'not installed')];
  },

  async uninstall(ctx, scope) {
    if (scope !== 'global') {
      throw new UnsupportedScope('Antigravity has no project scope. Use global.');
    }
    if (!ctx.present('agy')) {
      return [step('antigravity', 'uninstall', 'skipped', 'agy is not on PATH')];
    }
    const removed = await ctx.run('agy', ['mcp', 'remove', SERVER_NAME]);
    await forget('antigravity', scopeKey('global', ctx.projectDir));
    return removed.code === 0
      ? [step('antigravity', 'uninstall', 'ok', 'removed with agy mcp remove')]
      : [step('antigravity', 'uninstall', 'skipped', 'not installed')];
  },

  async doctor(ctx) {
    if (!ctx.present('agy')) {
      return [step('antigravity', 'global', 'skipped', 'agy is not on PATH')];
    }
    const listed = await ctx.run('agy', ['mcp', 'list']);
    return [
      listed.stdout.includes(SERVER_NAME)
        ? step('antigravity', 'global', 'ok', 'listed by agy mcp list')
        : step('antigravity', 'global', 'skipped', 'not installed'),
    ];
  },
};
