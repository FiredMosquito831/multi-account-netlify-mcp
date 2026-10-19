import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { forget, readIfExists, record, recordedItems, scopeKey } from './state.js';
import { installSkill, pruneEmpty, removeSkill, skillInstalled } from './skill.js';
import { SERVER_NAME, step, UnsupportedScope, type AgentAdapter, type Context, type Step } from './types.js';

const TABLE = `mcp_servers.${SERVER_NAME}`;

// Removes [table] and its [table.*] sub-tables from TOML text. Other tables are kept exactly as they are.
export const removeTomlTable = (text: string, table: string): { text: string; removed: number } => {
  const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/;
  const keep: string[] = [];
  let removed = 0;
  let skipping = false;
  for (const line of text.split(/(?<=\n)/)) {
    const match = header.exec(line);
    if (match) {
      const name = match[1].trim();
      if (name === table || name.startsWith(`${table}.`)) {
        skipping = true;
        if (name === table) {
          removed += 1;
        }
        continue;
      }
      skipping = false;
    }
    if (!skipping) {
      keep.push(line);
    }
  }
  return { text: keep.join(''), removed };
};

// TOML literal strings (single quotes) keep Windows paths as written, so they cannot contain a quote.
const literal = (value: string): string => {
  if (/['\r\n]/.test(value)) {
    throw new Error(`A value cannot be written as a TOML literal: ${value}`);
  }
  return `'${value}'`;
};

const projectConfig = (ctx: Context): string => path.join(ctx.projectDir, '.codex', 'config.toml');
// Codex's user skills live in CODEX_HOME/skills. A project's skills live in .agents/skills in the folder.
const globalSkills = (ctx: Context): string => path.join(ctx.codexHome, 'skills');
const projectSkills = (ctx: Context): string => path.join(ctx.projectDir, '.agents', 'skills');

const serverBlock = (ctx: Context): string =>
  `[${TABLE}]\ncommand = ${literal(process.execPath)}\nargs = [${[ctx.cliPath, 'serve'].map(literal).join(', ')}]\n`;

const addGlobal = async (ctx: Context): Promise<Step[]> => {
  if (!ctx.present('codex')) {
    return [step('codex', 'global', 'skipped', 'codex is not on PATH')];
  }
  // codex mcp add does not replace an existing entry, so the old one is removed first.
  await ctx.run('codex', ['mcp', 'remove', SERVER_NAME]);
  const added = await ctx.run('codex', ['mcp', 'add', SERVER_NAME, '--', process.execPath, ctx.cliPath, 'serve']);
  if (added.code !== 0) {
    return [step('codex', 'global', 'error', added.stderr.trim() || added.stdout.trim() || `exit ${added.code}`)];
  }
  const key = scopeKey('global', ctx.projectDir);
  await record('codex', key, { kind: 'mcp-entry', path: 'codex mcp', name: SERVER_NAME });
  const folder = await installSkill(ctx.packageRoot, globalSkills(ctx));
  await record('codex', key, { kind: 'directory', path: folder });
  return [
    step('codex', 'global', 'ok', `added with codex mcp add (${SERVER_NAME})`),
    step('codex', 'global skill', 'ok', folder),
  ];
};

const addProject = async (ctx: Context): Promise<Step[]> => {
  const steps: Step[] = [];
  // A global entry next to a project one would make two servers with the same name, so the global one goes.
  if (recordedItems('codex', 'global').length > 0) {
    if (ctx.present('codex')) {
      await ctx.run('codex', ['mcp', 'remove', SERVER_NAME]);
    }
    await removeSkill(globalSkills(ctx));
    await forget('codex', 'global');
    steps.push(step('codex', 'global cleanup', 'ok', 'removed the global entry and skill, so only this folder has them'));
  }

  const file = projectConfig(ctx);
  const current = (await readIfExists(file)) ?? '';
  const { text } = removeTomlTable(current, TABLE);
  const separator = text.trim() === '' ? '' : `${text.endsWith('\n') ? '' : '\n'}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${text.trim() === '' ? '' : text}${separator}${serverBlock(ctx)}`, 'utf8');
  const key = scopeKey('project', ctx.projectDir);
  await record('codex', key, { kind: 'toml-table', path: file, name: TABLE });
  steps.push(step('codex', 'project mcp', 'ok', `${file} (Codex reads this only when the folder is trusted)`));

  const folder = await installSkill(ctx.packageRoot, projectSkills(ctx));
  await record('codex', key, { kind: 'directory', path: folder });
  steps.push(step('codex', 'project skill', 'ok', folder));
  return steps;
};

const removeGlobal = async (ctx: Context): Promise<Step[]> => {
  const steps: Step[] = [];
  const key = scopeKey('global', ctx.projectDir);
  if (ctx.present('codex')) {
    const removed = await ctx.run('codex', ['mcp', 'remove', SERVER_NAME]);
    steps.push(
      removed.code === 0
        ? step('codex', 'global uninstall', 'ok', 'removed with codex mcp remove')
        : step('codex', 'global uninstall', 'skipped', 'not installed globally'),
    );
  } else {
    steps.push(step('codex', 'global uninstall', 'skipped', 'codex is not on PATH'));
  }
  // The skill is removed only when this tool recorded it, so a skill the user wrote is never touched.
  if (recordedItems('codex', key).some((item) => item.kind === 'directory')) {
    await removeSkill(globalSkills(ctx));
    steps.push(step('codex', 'global skill uninstall', 'ok', 'removed the skill folder'));
  }
  await forget('codex', key);
  return steps;
};

const removeProject = async (ctx: Context): Promise<Step[]> => {
  const steps: Step[] = [];
  const file = projectConfig(ctx);
  const key = scopeKey('project', ctx.projectDir);
  const current = await readIfExists(file);
  if (current === undefined) {
    steps.push(step('codex', 'project uninstall', 'skipped', 'no .codex/config.toml in this folder'));
  } else {
    const { text, removed } = removeTomlTable(current, TABLE);
    if (removed === 0) {
      steps.push(step('codex', 'project uninstall', 'skipped', 'not installed in this folder'));
    } else {
      // A file left empty was created by the install, so it is removed, and so is its folder if nothing else is in it.
      if (text.trim() === '') {
        await rm(file, { force: true });
        await rmdir(path.dirname(file)).catch(() => undefined);
      } else {
        await writeFile(file, text, 'utf8');
      }
      steps.push(step('codex', 'project uninstall', 'ok', `removed from ${file}`));
    }
  }
  if (recordedItems('codex', key).some((item) => item.kind === 'directory')) {
    await removeSkill(projectSkills(ctx));
    await pruneEmpty([projectSkills(ctx), path.join(ctx.projectDir, '.agents')]);
    steps.push(step('codex', 'project skill uninstall', 'ok', 'removed the skill folder'));
  }
  await forget('codex', key);
  return steps;
};

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  scopes: ['global', 'project'],

  present: (ctx) => ctx.present('codex'),

  async install(ctx, scope) {
    if (scope === 'local') {
      throw new UnsupportedScope('codex has no local scope. Use global or project.');
    }
    return scope === 'global' ? addGlobal(ctx) : addProject(ctx);
  },

  // Refreshes only what is already installed. Update never adds an install to a scope that has none.
  async update(ctx, scope) {
    const installed =
      scope === 'global'
        ? recordedItems('codex', 'global').length > 0
        : ((await readIfExists(projectConfig(ctx))) ?? '').includes(`[${TABLE}]`);
    return installed ? this.install(ctx, scope) : [step('codex', 'update', 'skipped', `not installed in the ${scope} scope`)];
  },

  async uninstall(ctx, scope) {
    if (scope === 'local') {
      throw new UnsupportedScope('codex has no local scope. Use global or project.');
    }
    return scope === 'global' ? removeGlobal(ctx) : removeProject(ctx);
  },

  async doctor(ctx) {
    const steps: Step[] = [];
    if (!ctx.present('codex')) {
      steps.push(step('codex', 'global', 'skipped', 'codex is not on PATH'));
    } else {
      const listed = await ctx.run('codex', ['mcp', 'list']);
      steps.push(
        listed.stdout.includes(SERVER_NAME)
          ? step('codex', 'global', 'ok', 'listed by codex mcp list')
          : step('codex', 'global', 'skipped', 'not installed globally'),
      );
    }
    steps.push(
      skillInstalled(globalSkills(ctx))
        ? step('codex', 'global skill', 'ok', path.join(globalSkills(ctx), 'netlify-accounts'))
        : step('codex', 'global skill', 'skipped', 'not installed globally'),
    );
    const current = await readIfExists(projectConfig(ctx));
    steps.push(
      current !== undefined && current.includes(`[${TABLE}]`)
        ? step('codex', 'project', 'ok', `in ${projectConfig(ctx)}`)
        : step('codex', 'project', 'skipped', 'not installed in this folder'),
    );
    steps.push(
      skillInstalled(projectSkills(ctx))
        ? step('codex', 'project skill', 'ok', path.join(projectSkills(ctx), 'netlify-accounts'))
        : step('codex', 'project skill', 'skipped', 'not installed in this folder'),
    );
    return steps;
  },
};
