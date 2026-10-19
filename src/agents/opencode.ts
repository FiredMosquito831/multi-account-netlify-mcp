import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { forget, readIfExists, record, recordedItems, scopeKey } from './state.js';
import { SERVER_NAME, step, UnsupportedScope, type AgentAdapter, type AgentScope, type Context, type Step } from './types.js';

// opencode reads ~/.config/opencode/opencode.json (global) and opencode.json in the folder (project).
// It has no command that adds an MCP server with a scope, so the file is edited. Only our own key and
// our own instruction are written or removed. Anything else in the file is kept.

interface Config {
  $schema?: string;
  mcp?: Record<string, unknown>;
  instructions?: string[];
  [key: string]: unknown;
}

const globalConfig = (ctx: Context): string => path.join(ctx.home, '.config', 'opencode', 'opencode.json');
const projectConfig = (ctx: Context): string => path.join(ctx.projectDir, 'opencode.json');
const skillDir = (ctx: Context): string => path.join(ctx.home, '.config', 'opencode', SERVER_NAME);
const skillFile = (ctx: Context): string => path.join(skillDir(ctx), 'SKILL.md');
const skillSource = (ctx: Context): string =>
  path.join(ctx.packageRoot, 'plugins', 'multi-account-netlify', 'skills', 'netlify-accounts', 'SKILL.md');
// opencode reads instructions as paths; forward slashes work on every platform.
const instructionPath = (ctx: Context): string => skillFile(ctx).split(path.sep).join('/');

const serverEntry = (ctx: Context) => ({
  type: 'local',
  command: [process.execPath, ctx.cliPath, 'serve'],
  enabled: true,
});

// Reads a config file. A file that is not valid JSON stops the change, so it is never overwritten.
const readConfig = async (file: string): Promise<Config | undefined> => {
  const raw = await readIfExists(file);
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as Config;
  } catch (error) {
    throw new Error(`${file} is not valid JSON, so it was not changed (${(error as Error).message}).`);
  }
};

// Keeps a copy of the file before it is changed. The copy is named <file>.bak.
const writeConfig = async (file: string, config: Config): Promise<void> => {
  if (existsSync(file)) {
    await copyFile(file, `${file}.bak`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
};

// Removes our key and instruction from one config file. Returns what was removed.
const dropFromConfig = async (file: string, ctx: Context, includeInstruction: boolean): Promise<string[]> => {
  const config = await readConfig(file);
  if (config === undefined) {
    return [];
  }
  const removed: string[] = [];
  if (config.mcp && SERVER_NAME in config.mcp) {
    delete config.mcp[SERVER_NAME];
    removed.push('mcp entry');
  }
  if (includeInstruction && config.instructions?.includes(instructionPath(ctx))) {
    config.instructions = config.instructions.filter((item) => item !== instructionPath(ctx));
    removed.push('instruction');
  }
  if (removed.length > 0) {
    // Empty containers that the install created are removed too, so the file returns to what it was.
    if (config.mcp && Object.keys(config.mcp).length === 0) {
      delete config.mcp;
    }
    if (config.instructions && config.instructions.length === 0) {
      delete config.instructions;
    }
    // A file that holds nothing but the schema line was created by the install, so it is removed.
    if (Object.keys(config).every((key) => key === '$schema')) {
      await rm(file, { force: true });
    } else {
      await writeConfig(file, config);
    }
  }
  return removed;
};

const removeGlobalSkill = async (ctx: Context): Promise<void> => {
  await rm(skillDir(ctx), { recursive: true, force: true });
};

const installGlobal = async (ctx: Context): Promise<Step[]> => {
  const steps: Step[] = [];
  const file = globalConfig(ctx);
  const config: Config = (await readConfig(file)) ?? { $schema: 'https://opencode.ai/config.json' };
  config.mcp = { ...(config.mcp ?? {}), [SERVER_NAME]: serverEntry(ctx) };
  config.instructions = [...(config.instructions ?? []).filter((item) => item !== instructionPath(ctx)), instructionPath(ctx)];

  // The skill is copied next to the config, so the instruction path stays valid if the package moves.
  await mkdir(skillDir(ctx), { recursive: true });
  await copyFile(skillSource(ctx), skillFile(ctx));
  await writeConfig(file, config);

  const key = scopeKey('global', ctx.projectDir);
  await record('opencode', key, { kind: 'mcp-entry', path: file, name: SERVER_NAME });
  await record('opencode', key, { kind: 'json-instruction', path: file, name: instructionPath(ctx) });
  await record('opencode', key, { kind: 'directory', path: skillDir(ctx) });
  steps.push(step('opencode', 'global mcp', 'ok', `${file}: mcp.${SERVER_NAME}`));
  steps.push(step('opencode', 'global skill', 'ok', skillFile(ctx)));

  // A project entry next to the global one would load the server twice.
  if (recordedItems('opencode', scopeKey('project', ctx.projectDir)).length > 0) {
    const removed = await dropFromConfig(projectConfig(ctx), ctx, false);
    await forget('opencode', scopeKey('project', ctx.projectDir));
    if (removed.length > 0) {
      steps.push(step('opencode', 'project cleanup', 'ok', 'removed the project entry, so only the global one is used'));
    }
  }
  return steps;
};

const installProject = async (ctx: Context): Promise<Step[]> => {
  const steps: Step[] = [];
  const file = projectConfig(ctx);
  const config: Config = (await readConfig(file)) ?? { $schema: 'https://opencode.ai/config.json' };
  config.mcp = { ...(config.mcp ?? {}), [SERVER_NAME]: serverEntry(ctx) };
  await writeConfig(file, config);
  await record('opencode', scopeKey('project', ctx.projectDir), { kind: 'mcp-entry', path: file, name: SERVER_NAME });
  steps.push(step('opencode', 'project mcp', 'ok', `${file} (the command holds this computer's path, so do not commit it)`));

  // The global entry and its skill are removed, so this folder does not load the server twice.
  if (recordedItems('opencode', 'global').length > 0) {
    const removed = await dropFromConfig(globalConfig(ctx), ctx, true);
    await removeGlobalSkill(ctx);
    await forget('opencode', 'global');
    if (removed.length > 0) {
      steps.push(step('opencode', 'global cleanup', 'ok', `removed ${removed.join(' and ')} from the global config`));
    }
  }
  return steps;
};

const uninstallGlobal = async (ctx: Context): Promise<Step> => {
  const removed = await dropFromConfig(globalConfig(ctx), ctx, true);
  await removeGlobalSkill(ctx);
  await forget('opencode', 'global');
  return removed.length > 0
    ? step('opencode', 'global uninstall', 'ok', `removed ${removed.join(' and ')}`)
    : step('opencode', 'global uninstall', 'skipped', 'not installed globally');
};

const uninstallProject = async (ctx: Context): Promise<Step> => {
  const removed = await dropFromConfig(projectConfig(ctx), ctx, false);
  await forget('opencode', scopeKey('project', ctx.projectDir));
  return removed.length > 0
    ? step('opencode', 'project uninstall', 'ok', `removed from ${projectConfig(ctx)}`)
    : step('opencode', 'project uninstall', 'skipped', 'not installed in this folder');
};

const hasEntry = async (file: string): Promise<boolean | 'invalid'> => {
  try {
    const config = await readConfig(file);
    return config?.mcp !== undefined && SERVER_NAME in config.mcp;
  } catch {
    return 'invalid';
  }
};

export const opencodeAdapter: AgentAdapter = {
  id: 'opencode',
  scopes: ['global', 'project'],

  present: (ctx) => ctx.present('opencode') || existsSync(path.join(ctx.home, '.config', 'opencode')),

  async install(ctx, scope) {
    if (scope === 'local') {
      throw new UnsupportedScope('opencode has no local scope. Use global or project.');
    }
    return scope === 'global' ? installGlobal(ctx) : installProject(ctx);
  },

  // Refreshes only what is already installed. Update never adds an install to a scope that has none.
  async update(ctx, scope) {
    const key = scope === 'global' ? 'global' : scopeKey('project', ctx.projectDir);
    return recordedItems('opencode', key).length > 0
      ? this.install(ctx, scope)
      : [step('opencode', 'update', 'skipped', `not installed in the ${scope} scope`)];
  },

  async uninstall(ctx, scope) {
    if (scope === 'local') {
      throw new UnsupportedScope('opencode has no local scope. Use global or project.');
    }
    return [scope === 'global' ? await uninstallGlobal(ctx) : await uninstallProject(ctx)];
  },

  async doctor(ctx) {
    const steps: Step[] = [];
    for (const [label, file] of [
      ['global', globalConfig(ctx)],
      ['project', projectConfig(ctx)],
    ] as const) {
      const found = await hasEntry(file);
      if (found === 'invalid') {
        steps.push(step('opencode', label, 'error', `${file} is not valid JSON`));
      } else {
        steps.push(found ? step('opencode', label, 'ok', `in ${file}`) : step('opencode', label, 'skipped', 'not installed'));
      }
    }
    if (ctx.present('opencode')) {
      const listed = await ctx.run('opencode', ['mcp', 'list']);
      steps.push(
        listed.stdout.includes(SERVER_NAME)
          ? step('opencode', 'opencode mcp list', 'ok', 'listed by opencode')
          : step('opencode', 'opencode mcp list', 'warning', 'not listed by opencode mcp list'),
      );
    }
    return steps;
  },
};

// Used by tests and by the skill copy check.
export const readSkillText = (ctx: Context): Promise<string> => readFile(skillSource(ctx), 'utf8');
