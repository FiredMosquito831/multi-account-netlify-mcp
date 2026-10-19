import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/client';
import type { CommandResult, Runner } from '../agents/command.js';
import { antigravityAdapter } from '../agents/antigravity.js';
import { codexAdapter } from '../agents/codex.js';
import { runAction } from '../agents/dispatch.js';
import { SKILL_NAME, skillSource } from '../agents/skill.js';
import type { Context } from '../agents/types.js';
import { multiAccountNote, withAccountParam } from '../mux/catalog.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = '/opt/multi-account-netlify-mcp/dist/cli.js';

let root: string;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'skills-test-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Box {
  home: string;
  codexHome: string;
  project: string;
  ctx: (present: string[]) => Context;
}

const box = async (name: string): Promise<Box> => {
  const base = path.join(root, name);
  const home = path.join(base, 'home');
  const codexHome = path.join(base, 'codex');
  const project = path.join(base, 'project');
  await mkdir(home, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await mkdir(project, { recursive: true });
  process.env.MULTI_ACCOUNT_NETLIFY_HOME = path.join(base, 'data');
  const run: Runner = async (): Promise<CommandResult> => ({ code: 0, stdout: '', stderr: '' });
  return {
    home,
    codexHome,
    project,
    ctx: (present) => ({
      home,
      codexHome,
      projectDir: project,
      cliPath: CLI,
      packageRoot: REPO_ROOT,
      run,
      present: (command) => present.includes(command),
    }),
  };
};

describe('the skill file', () => {
  it('ships in the package and is agent-neutral in its instructions', async () => {
    const text = await readFile(skillSource(REPO_ROOT), 'utf8');
    assert.match(text, /^---\nname: netlify-accounts\n/);
    assert.match(text, /multi-account-netlify-mcp add <name>/, 'the terminal command works for every agent');
    assert.match(text, /Never ask the user to paste a token/);
  });
});

describe('codex skills', () => {
  it('global: copies the skill into CODEX_HOME/skills and removes it again on uninstall', async () => {
    const b = await box('codex-skill-global');
    await codexAdapter.install(b.ctx(['codex']), 'global');
    const installed = path.join(b.codexHome, 'skills', SKILL_NAME, 'SKILL.md');
    assert.ok(existsSync(installed));
    assert.equal(await readFile(installed, 'utf8'), await readFile(skillSource(REPO_ROOT), 'utf8'));

    await codexAdapter.uninstall(b.ctx(['codex']), 'global');
    assert.equal(existsSync(path.join(b.codexHome, 'skills', SKILL_NAME)), false);
  });

  it('project: copies the skill into .agents/skills and removes it, with the folders it created', async () => {
    const b = await box('codex-skill-project');
    await codexAdapter.install(b.ctx(['codex']), 'project');
    assert.ok(existsSync(path.join(b.project, '.agents', 'skills', SKILL_NAME, 'SKILL.md')));

    await codexAdapter.uninstall(b.ctx(['codex']), 'project');
    assert.equal(existsSync(path.join(b.project, '.agents')), false, 'the .agents folder it created is gone');
  });

  it('uninstall leaves a skill folder alone when this tool did not record it', async () => {
    const b = await box('codex-skill-user');
    const folder = path.join(b.codexHome, 'skills', SKILL_NAME);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'SKILL.md'), 'written by the user', 'utf8');

    await codexAdapter.uninstall(b.ctx(['codex']), 'global');
    assert.equal(await readFile(path.join(folder, 'SKILL.md'), 'utf8'), 'written by the user');
  });

  it('doctor reports whether the skill is installed', async () => {
    const b = await box('codex-skill-doctor');
    const before = await codexAdapter.doctor(b.ctx([]));
    assert.equal(before.find((item) => item.action === 'global skill')?.status, 'skipped');
    await codexAdapter.install(b.ctx(['codex']), 'global');
    const after = await codexAdapter.doctor(b.ctx(['codex']));
    assert.equal(after.find((item) => item.action === 'global skill')?.status, 'ok');
  });
});

describe('antigravity skill', () => {
  it('installs into ~/.gemini/config/skills and removes it on uninstall', async () => {
    const b = await box('agy-skill');
    await antigravityAdapter.install(b.ctx(['agy']), 'global');
    const installed = path.join(b.home, '.gemini', 'config', 'skills', SKILL_NAME, 'SKILL.md');
    assert.ok(existsSync(installed));

    await antigravityAdapter.uninstall(b.ctx(['agy']), 'global');
    assert.equal(existsSync(path.join(b.home, '.gemini', 'config', 'skills', SKILL_NAME)), false);
  });

  it('an install into all agents covers the skill too', async () => {
    const b = await box('agy-skill-all');
    await runAction('install', { agents: ['antigravity'], scope: 'global' }, b.ctx(['agy']));
    assert.ok(existsSync(path.join(b.home, '.gemini', 'config', 'skills', SKILL_NAME, 'SKILL.md')));
  });
});

const selectorTool = (name: string, operations: string[], readOnlyHint: boolean): Tool =>
  ({
    name,
    description: `Official description of ${name}.`,
    annotations: { readOnlyHint },
    inputSchema: {
      type: 'object',
      properties: {
        selectSchema: {
          anyOf: operations.map((operation) => ({
            type: 'object',
            properties: { operation: { const: operation } },
          })),
        },
      },
    },
  }) as unknown as Tool;

describe('tool definitions carry the multi-account rules', () => {
  it('a reader tool says which operations can span accounts, and how', () => {
    const reader = selectorTool('netlify-project-services-reader', ['get-projects', 'get-project'], true);
    const note = multiAccountNote(reader);
    assert.match(note, /get-projects: every named account answers/);
    assert.match(note, /get-project: only the account that owns the id answers/);
  });

  it('a writer tool says its operations need one account, and that a list or all is refused', () => {
    const writer = selectorTool('netlify-deploy-services-updater', ['deploy-site'], false);
    assert.match(multiAccountNote(writer), /deploy-site: one account only, so a list or all is refused/);
  });

  it('describes the two mixed operations in parts', () => {
    const writer = selectorTool('netlify-project-services-updater', ['manage-env-vars', 'manage-form-submissions'], false);
    const note = multiAccountNote(writer);
    assert.match(note, /manage-env-vars: listing needs the account that owns the site/);
    assert.match(note, /manage-form-submissions: get-submissions needs the account that owns the form/);
  });

  it('keeps the official description and adds the note after it', () => {
    const reader = selectorTool('netlify-user-services-reader', ['get-user'], true);
    const described = withAccountParam(reader, ['work']);
    assert.match(described.description ?? '', /^Official description of netlify-user-services-reader\./);
    assert.match(described.description ?? '', /get-user: every named account answers/);
  });

  it('the account argument says changes need one name, and lists the accounts', () => {
    const described = withAccountParam(selectorTool('netlify-team-services-reader', ['get-teams'], true), ['work', 'personal']);
    const account = (described.inputSchema.properties as Record<string, { description: string }>).account.description;
    assert.match(account, /changes need one name/);
    assert.match(account, /Accounts: work, personal/);
  });

  it('an operation the table does not know is described as one account', () => {
    const odd = selectorTool('netlify-odd-services-reader', ['not-yet-classified'], true);
    assert.match(multiAccountNote(odd), /not-yet-classified: one account only/);
  });
});
