import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CommandResult, Runner } from '../agents/command.js';
import { antigravityAdapter } from '../agents/antigravity.js';
import { codexAdapter, removeTomlTable } from '../agents/codex.js';
import { ADAPTERS, runAction } from '../agents/dispatch.js';
import { commandLine, completeAnswers, parseAgentAnswer, parseInstallArgs, parseScopeAnswer } from '../agents/install-flow.js';
import { opencodeAdapter } from '../agents/opencode.js';
import { readState, scopeKey } from '../agents/state.js';
import { AGENTS, UnsupportedScope, type Context } from '../agents/types.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = '/opt/multi-account-netlify-mcp/dist/cli.js';

let root: string;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agents-test-'));
  process.env.MULTI_ACCOUNT_NETLIFY_HOME = path.join(root, 'data');
});
after(async () => {
  delete process.env.MULTI_ACCOUNT_NETLIFY_HOME;
  await rm(root, { recursive: true, force: true });
});

interface Sandbox {
  home: string;
  project: string;
  calls: { command: string; args: string[] }[];
  ctx: (present: string[], answers?: Record<string, CommandResult>) => Context;
}

// A temporary home and project folder, and a runner that records calls and answers from a script.
const sandbox = async (name: string): Promise<Sandbox> => {
  const base = path.join(root, name);
  const home = path.join(base, 'home');
  const project = path.join(base, 'project');
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
  // Each sandbox has its own ownership record, so one test cannot see another test's installs.
  process.env.MULTI_ACCOUNT_NETLIFY_HOME = path.join(base, 'data');
  const calls: { command: string; args: string[] }[] = [];
  return {
    home,
    project,
    calls,
    ctx(present, answers = {}) {
      const run: Runner = async (command, args) => {
        calls.push({ command, args: [...args] });
        const answer = answers[`${command} ${args.join(' ')}`] ?? answers[command];
        return answer ?? { code: 0, stdout: '', stderr: '' };
      };
      return {
        home,
        codexHome: path.join(home, '.codex'),
        projectDir: project,
        cliPath: CLI,
        packageRoot: REPO_ROOT,
        run,
        present: (command) => present.includes(command),
      };
    },
  };
};

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });

describe('install arguments and answers', () => {
  it('reads agents, scope and flags, and rejects unknown options and missing values', () => {
    assert.deepEqual(parseInstallArgs(['codex', 'opencode', '--scope', 'project', '--project-dir', 'D:/x', '--dry-run']), {
      agents: ['codex', 'opencode'],
      scope: 'project',
      projectDir: 'D:/x',
      dryRun: true,
      yes: false,
    });
    assert.throws(() => parseInstallArgs(['--scpe', 'project']), /Unknown option/);
    assert.throws(() => parseInstallArgs(['--scope']), /needs a value/);
  });

  it('turns an agent answer into names: numbers, names, all, or an empty answer', () => {
    assert.deepEqual(parseAgentAnswer(''), ['all']);
    assert.deepEqual(parseAgentAnswer('1,3'), [AGENTS[0], AGENTS[2]]);
    assert.deepEqual(parseAgentAnswer('codex opencode codex'), ['codex', 'opencode']);
    assert.equal(parseAgentAnswer('cursor'), undefined);
  });

  it('turns a scope answer into a scope; empty means global', () => {
    assert.equal(parseScopeAnswer(''), 'global');
    assert.equal(parseScopeAnswer('2'), 'project');
    assert.equal(parseScopeAnswer('local'), 'local');
    assert.equal(parseScopeAnswer('everywhere'), undefined);
  });

  it('shows the exact command for the answers', () => {
    assert.equal(
      commandLine({ agents: ['codex'], scope: 'project', projectDir: 'D:/work/app' }),
      'multi-account-netlify-mcp install codex --scope project --project-dir "D:/work/app"',
    );
    assert.equal(commandLine({ agents: ['all'], scope: 'global' }), 'multi-account-netlify-mcp install all --scope global');
  });
});

describe('guided answers', () => {
  it('asks only for what the flags did not give, and asks again after an invalid answer', async () => {
    const box = await sandbox('guided-ask');
    const answers = ['9', '1,2', '3', '/x/elsewhere'];
    const asked: string[] = [];
    const ask = async (question: string) => {
      asked.push(question);
      return answers.shift() ?? '';
    };
    const lines: string[] = [];
    const result = await completeAnswers({}, box.ctx([]), ask, (line) => lines.push(line));

    assert.deepEqual(result, { agents: ['claude', 'codex'], scope: 'local', projectDir: '/x/elsewhere' });
    assert.equal(asked.length, 4, 'agents twice (one invalid), scope, then folder');
    assert.ok(lines.some((line) => /Not a valid choice/.test(line)));
  });

  it('asks nothing when the flags answer everything', async () => {
    const box = await sandbox('guided-none');
    const ask = async () => {
      throw new Error('should not be asked');
    };
    const result = await completeAnswers({ agents: ['codex'], scope: 'global' }, box.ctx([]), ask, () => undefined);
    assert.deepEqual(result, { agents: ['codex'], scope: 'global', projectDir: undefined });
  });
});

describe('codex', () => {
  it('removes only the server table and its sub-tables from TOML, keeping every other table', () => {
    const text = '[model]\nname = "x"\n\n[mcp_servers.multi-account-netlify]\ncommand = \'node\'\n\n[mcp_servers.multi-account-netlify.env]\nA = "1"\n\n[mcp_servers.other]\ncommand = \'y\'\n';
    const { text: next, removed } = removeTomlTable(text, 'mcp_servers.multi-account-netlify');
    assert.equal(removed, 1);
    assert.match(next, /\[model\]/);
    assert.match(next, /\[mcp_servers\.other\]/);
    assert.doesNotMatch(next, /multi-account-netlify/);
  });

  it('global: uses codex mcp remove then codex mcp add, and records the entry', async () => {
    const box = await sandbox('codex-global');
    const steps = await codexAdapter.install(box.ctx(['codex']), 'global');

    assert.equal(steps[0].status, 'ok');
    assert.deepEqual(box.calls.map((call) => call.args.slice(0, 2)), [
      ['mcp', 'remove'],
      ['mcp', 'add'],
    ]);
    assert.deepEqual(box.calls[1].args, ['mcp', 'add', 'multi-account-netlify', '--', process.execPath, CLI, 'serve']);
    // The server entry and the skill folder are both recorded.
    assert.equal(readState('codex')[scopeKey('global', box.project)]?.length, 2);
  });

  it('global: is skipped, not an error, when codex is not on PATH', async () => {
    const box = await sandbox('codex-absent');
    const steps = await codexAdapter.install(box.ctx([]), 'global');
    assert.equal(steps[0].status, 'skipped');
    assert.equal(box.calls.length, 0);
  });

  it('project: writes only its table into .codex/config.toml, keeping what was there', async () => {
    const box = await sandbox('codex-project');
    const file = path.join(box.project, '.codex', 'config.toml');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '[profile.work]\nmodel = "gpt"\n', 'utf8');

    await codexAdapter.install(box.ctx(['codex']), 'project');
    const written = await readFile(file, 'utf8');
    assert.match(written, /\[profile\.work\]/);
    assert.match(written, /\[mcp_servers\.multi-account-netlify\]/);
    assert.match(written, /command = '/);

    // Installing again keeps exactly one table.
    await codexAdapter.install(box.ctx(['codex']), 'project');
    assert.equal((await readFile(file, 'utf8')).split('[mcp_servers.multi-account-netlify]').length, 2);
  });

  it('project uninstall removes only that table, and reports when nothing is installed', async () => {
    const box = await sandbox('codex-project-uninstall');
    await codexAdapter.install(box.ctx(['codex']), 'project');
    const file = path.join(box.project, '.codex', 'config.toml');
    await writeFile(file, `${await readFile(file, 'utf8')}\n[profile.keep]\nmodel = "a"\n`, 'utf8');

    const removed = await codexAdapter.uninstall(box.ctx(['codex']), 'project');
    assert.equal(removed[0].status, 'ok');
    const after = await readFile(file, 'utf8');
    assert.match(after, /\[profile\.keep\]/);
    assert.doesNotMatch(after, /multi-account-netlify/);

    const again = await codexAdapter.uninstall(box.ctx(['codex']), 'project');
    assert.equal(again[0].status, 'skipped');
  });

  it('project: an install into a folder with no config leaves nothing behind after uninstall', async () => {
    const box = await sandbox('codex-clean');
    await codexAdapter.install(box.ctx(['codex']), 'project');
    await codexAdapter.uninstall(box.ctx(['codex']), 'project');
    assert.equal(existsSync(path.join(box.project, '.codex', 'config.toml')), false);
    assert.equal(existsSync(path.join(box.project, '.codex')), false);
  });

  it('refuses the local scope', async () => {
    const box = await sandbox('codex-local');
    await assert.rejects(codexAdapter.install(box.ctx(['codex']), 'local'), UnsupportedScope);
  });
});

describe('opencode', () => {
  const globalConfig = (box: Sandbox) => path.join(box.home, '.config', 'opencode', 'opencode.json');

  it('global: adds the server and its skill instruction, copies the skill, and backs up the file', async () => {
    const box = await sandbox('opencode-global');
    await mkdir(path.dirname(globalConfig(box)), { recursive: true });
    await writeFile(globalConfig(box), JSON.stringify({ theme: 'dark', mcp: { other: { type: 'remote' } } }), 'utf8');

    await opencodeAdapter.install(box.ctx([]), 'global');
    const config = JSON.parse(await readFile(globalConfig(box), 'utf8'));
    assert.equal(config.theme, 'dark');
    assert.ok(config.mcp.other, 'other servers are kept');
    assert.deepEqual(config.mcp['multi-account-netlify'].command, [process.execPath, CLI, 'serve']);
    assert.equal(config.instructions.length, 1);
    assert.ok(existsSync(path.join(box.home, '.config', 'opencode', 'multi-account-netlify', 'SKILL.md')));
    assert.ok(existsSync(`${globalConfig(box)}.bak`));
  });

  it('refuses a config file that is not valid JSON, and leaves it unchanged', async () => {
    const box = await sandbox('opencode-invalid');
    await mkdir(path.dirname(globalConfig(box)), { recursive: true });
    await writeFile(globalConfig(box), '{ // a comment\n', 'utf8');

    await assert.rejects(opencodeAdapter.install(box.ctx([]), 'global'), /not valid JSON, so it was not changed/);
    assert.equal(await readFile(globalConfig(box), 'utf8'), '{ // a comment\n');
  });

  it('uninstall global removes only its key, its instruction and its skill folder', async () => {
    const box = await sandbox('opencode-uninstall');
    await opencodeAdapter.install(box.ctx([]), 'global');
    const config = JSON.parse(await readFile(globalConfig(box), 'utf8'));
    config.mcp.other = { type: 'remote' };
    await writeFile(globalConfig(box), JSON.stringify(config), 'utf8');

    const removed = await opencodeAdapter.uninstall(box.ctx([]), 'global');
    assert.equal(removed[0].status, 'ok');
    const after = JSON.parse(await readFile(globalConfig(box), 'utf8'));
    assert.equal(after.mcp['multi-account-netlify'], undefined);
    assert.ok(after.mcp.other);
    assert.equal(after.instructions, undefined, 'the empty instructions list the install created is removed');
    assert.equal(existsSync(path.join(box.home, '.config', 'opencode', 'multi-account-netlify')), false);
  });

  it('project install removes the global entry, so the server is not loaded twice', async () => {
    const box = await sandbox('opencode-switch');
    await opencodeAdapter.install(box.ctx([]), 'global');
    await opencodeAdapter.install(box.ctx([]), 'project');

    // The global file held only our entries, so it may be gone. Either way the global entry is not there.
    const global = existsSync(globalConfig(box)) ? JSON.parse(await readFile(globalConfig(box), 'utf8')) : {};
    assert.equal(global.mcp?.['multi-account-netlify'], undefined);
    const project = JSON.parse(await readFile(path.join(box.project, 'opencode.json'), 'utf8'));
    assert.ok(project.mcp['multi-account-netlify']);
  });

  it('project: uninstall removes a file the install created, and keeps one the user had', async () => {
    const created = await sandbox('opencode-created');
    await opencodeAdapter.install(created.ctx([]), 'project');
    await opencodeAdapter.uninstall(created.ctx([]), 'project');
    assert.equal(existsSync(path.join(created.project, 'opencode.json')), false);

    const kept = await sandbox('opencode-kept');
    await writeFile(path.join(kept.project, 'opencode.json'), JSON.stringify({ theme: 'dark' }), 'utf8');
    await opencodeAdapter.install(kept.ctx([]), 'project');
    await opencodeAdapter.uninstall(kept.ctx([]), 'project');
    assert.deepEqual(JSON.parse(await readFile(path.join(kept.project, 'opencode.json'), 'utf8')), { theme: 'dark' });
  });

  it('refuses the local scope', async () => {
    const box = await sandbox('opencode-local');
    await assert.rejects(opencodeAdapter.install(box.ctx([]), 'local'), UnsupportedScope);
  });
});

describe('antigravity', () => {
  it('global: registers the server with agy mcp add, and installs the skill', async () => {
    const box = await sandbox('agy-global');
    const steps = await antigravityAdapter.install(box.ctx(['agy']), 'global');

    assert.deepEqual(box.calls[0].args, ['mcp', 'add', 'multi-account-netlify', '--', process.execPath, CLI, 'serve']);
    assert.equal(steps[0].status, 'ok');
    assert.equal(steps[1].status, 'ok');
    assert.ok(existsSync(path.join(box.home, '.gemini', 'config', 'skills', 'netlify-accounts', 'SKILL.md')));
  });

  it('has no project scope, and says so', async () => {
    const box = await sandbox('agy-project');
    await assert.rejects(antigravityAdapter.install(box.ctx(['agy']), 'project'), /no project scope/);
  });

  it('update never adds an install that does not exist', async () => {
    const box = await sandbox('agy-update');
    const steps = await antigravityAdapter.update(box.ctx(['agy']), 'global');
    assert.equal(steps[0].status, 'skipped');
    assert.equal(box.calls.length, 0);
  });
});

describe('dispatch', () => {
  it('installs into the agents set up here, and skips the rest', async () => {
    const box = await sandbox('dispatch-present');
    const steps = await runAction('install', { scope: 'global' }, box.ctx(['codex']));

    assert.ok(steps.some((item) => item.agent === 'codex' && item.status === 'ok'));
    assert.equal(
      steps.some((item) => item.agent === 'claude'),
      false,
      'claude is not set up here, so it is not chosen',
    );
    assert.equal(
      box.calls.some((call) => call.command === 'claude'),
      false,
    );
  });

  it('skips an agent that lacks the requested scope when agents were not named', async () => {
    const box = await sandbox('dispatch-skip');
    const steps = await runAction('install', { scope: 'project' }, box.ctx(['agy']));
    const skipped = steps.find((item) => item.agent === 'antigravity');
    assert.equal(skipped?.status, 'skipped');
    assert.match(skipped?.detail ?? '', /does not support the project scope/);
  });

  it('errors when an agent was named together with a scope it lacks', async () => {
    const box = await sandbox('dispatch-named');
    await assert.rejects(runAction('install', { agents: ['antigravity'], scope: 'project' }, box.ctx(['agy'])), UnsupportedScope);
  });

  it('uninstall with scope all covers every scope each agent supports', async () => {
    const box = await sandbox('dispatch-all-scopes');
    const steps = await runAction('uninstall', { agents: ['codex'], scope: 'all' }, box.ctx(['codex']));
    const actions = steps.map((item) => item.action);
    assert.equal(actions.filter((action) => action === 'global uninstall').length, 1);
    assert.equal(actions.filter((action) => action === 'project uninstall').length, 1);
  });

  it('rejects an unknown agent name instead of doing nothing', async () => {
    const box = await sandbox('dispatch-unknown');
    await assert.rejects(runAction('install', { agents: ['cursor'] }, box.ctx([])), /Unknown agent: cursor/);
  });

  it('keeps one adapter per agent', () => {
    assert.deepEqual(Object.keys(ADAPTERS).sort(), [...AGENTS].sort());
  });
});

describe('ownership', () => {
  it('keys a project scope by its folder, and the global scope by one name', () => {
    assert.equal(scopeKey('global', 'D:/work'), 'global');
    assert.match(scopeKey('project', 'D:/work/app'), /^project:/);
  });

  it('keeps a record per scope, so a project install is not mistaken for a global one', async () => {
    const box = await sandbox('ownership-scopes');
    await codexAdapter.install(box.ctx(['codex']), 'project');
    assert.equal(readState('codex')[scopeKey('global', box.project)], undefined);
    assert.equal(readState('codex')[scopeKey('project', box.project)]?.length, 2);
  });
});
