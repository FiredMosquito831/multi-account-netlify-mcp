import path from 'node:path';
import { forget, record, recordedItems, scopeKey } from './state.js';
import { installSkill, removeSkill, skillInstalled } from './skill.js';
import { SERVER_NAME, step, UnsupportedScope, type AgentAdapter, type Context, type Step } from './types.js';

// Google Antigravity (agy). It has no project scope. It registers servers through `agy mcp`, and it reads
// user skills from ~/.gemini/config/skills/<name>/SKILL.md (the same layout as its bundled skills).
const skillsRoot = (ctx: Context): string => path.join(ctx.home, '.gemini', 'config', 'skills');

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
    const key = scopeKey('global', ctx.projectDir);
    await record('antigravity', key, { kind: 'mcp-entry', path: 'agy mcp', name: SERVER_NAME });
    const folder = await installSkill(ctx.packageRoot, skillsRoot(ctx));
    await record('antigravity', key, { kind: 'directory', path: folder });
    return [
      step('antigravity', 'mcp add', 'ok', `added with agy mcp add (${SERVER_NAME})`),
      step('antigravity', 'skill', 'ok', folder),
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
    const key = scopeKey('global', ctx.projectDir);
    const steps: Step[] = [];
    if (!ctx.present('agy')) {
      steps.push(step('antigravity', 'uninstall', 'skipped', 'agy is not on PATH'));
    } else {
      const removed = await ctx.run('agy', ['mcp', 'remove', SERVER_NAME]);
      steps.push(
        removed.code === 0
          ? step('antigravity', 'uninstall', 'ok', 'removed with agy mcp remove')
          : step('antigravity', 'uninstall', 'skipped', 'not installed'),
      );
    }
    // Only a skill this tool recorded is removed.
    if (recordedItems('antigravity', key).some((item) => item.kind === 'directory')) {
      await removeSkill(skillsRoot(ctx));
      steps.push(step('antigravity', 'skill uninstall', 'ok', 'removed the skill folder'));
    }
    await forget('antigravity', key);
    return steps;
  },

  async doctor(ctx) {
    const steps: Step[] = [];
    if (!ctx.present('agy')) {
      steps.push(step('antigravity', 'global', 'skipped', 'agy is not on PATH'));
    } else {
      const listed = await ctx.run('agy', ['mcp', 'list']);
      steps.push(
        listed.stdout.includes(SERVER_NAME)
          ? step('antigravity', 'global', 'ok', 'listed by agy mcp list')
          : step('antigravity', 'global', 'skipped', 'not installed'),
      );
    }
    steps.push(
      skillInstalled(skillsRoot(ctx))
        ? step('antigravity', 'skill', 'ok', path.join(skillsRoot(ctx), 'netlify-accounts'))
        : step('antigravity', 'skill', 'skipped', 'not installed'),
    );
    return steps;
  },
};
