import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GITHUB_SOURCE,
  MARKETPLACE_NAME,
  PLUGIN_ID,
  installPlugin,
  listInstalls,
  parseScope,
  uninstallPlugin,
  updatePlugin,
  type ClaudeRunner,
  type RunResult,
} from '../install/claude-plugin.js';

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });

// Records every call and answers from a script. The real `claude` CLI is never started.
const fakeClaude = (answers: { marketplaces?: string[]; plugins?: unknown[]; failOn?: string; alreadyDeclared?: boolean } = {}) => {
  const calls: { args: string[]; cwd?: string }[] = [];
  const run: ClaudeRunner = async (args, options) => {
    calls.push({ args: [...args], cwd: options?.cwd });
    const line = args.join(' ');
    if (answers.failOn && line.includes(answers.failOn)) {
      return { code: 1, stdout: '', stderr: `boom: ${answers.failOn}` };
    }
    if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
      return ok(JSON.stringify((answers.marketplaces ?? []).map((name) => ({ name }))));
    }
    if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add' && answers.alreadyDeclared) {
      return { code: 1, stdout: '', stderr: 'Marketplace is already declared in this scope' };
    }
    if (args[0] === 'plugin' && args[1] === 'list') {
      return ok(JSON.stringify(answers.plugins ?? []));
    }
    return ok();
  };
  return { run, calls };
};

const baseOptions = {
  source: 'D:/npm/node_modules/multi-account-netlify-mcp',
};

describe('parseScope', () => {
  it('defaults to the given fallback, and accepts user as an alias of global', () => {
    assert.equal(parseScope(undefined, 'global'), 'global');
    assert.equal(parseScope('user', 'global'), 'global');
    assert.equal(parseScope('project', 'global'), 'project');
    assert.equal(parseScope('local', 'global'), 'local');
  });

  it('allows all only where the fallback is all', () => {
    assert.equal(parseScope('all', 'all'), 'all');
    assert.throws(() => parseScope('all', 'global'), /--scope must be global, project or local/);
  });

  it('rejects an unknown scope', () => {
    assert.throws(() => parseScope('machine', 'global'), /--scope must be/);
  });
});

describe('installPlugin', () => {
  it('global: adds the marketplace once in user scope, then installs with no settings', async () => {
    const fake = fakeClaude({ marketplaces: [] });
    await installPlugin({ ...baseOptions, scope: 'global', run: fake.run });

    assert.deepEqual(fake.calls.map((call) => call.args), [
      ['plugin', 'marketplace', 'list', '--json'],
      ['plugin', 'marketplace', 'add', baseOptions.source, '--scope', 'user'],
      ['plugin', 'install', PLUGIN_ID, '--scope', 'user'],
    ]);
  });

  it('global: refreshes the marketplace instead of adding it again', async () => {
    const fake = fakeClaude({ marketplaces: [MARKETPLACE_NAME] });
    await installPlugin({ ...baseOptions, scope: 'global', run: fake.run });

    assert.deepEqual(fake.calls[1].args, ['plugin', 'marketplace', 'update', MARKETPLACE_NAME]);
  });

  it('project: declares the marketplace in project scope every time, in the given folder', async () => {
    const fake = fakeClaude({ marketplaces: [MARKETPLACE_NAME] });
    await installPlugin({ ...baseOptions, source: GITHUB_SOURCE, scope: 'project', projectDir: 'D:/work/app', run: fake.run });

    assert.deepEqual(fake.calls.map((call) => call.args), [
      ['plugin', 'marketplace', 'add', GITHUB_SOURCE, '--scope', 'project'],
      ['plugin', 'install', PLUGIN_ID, '--scope', 'project'],
    ]);
    assert.ok(fake.calls.every((call) => call.cwd === 'D:/work/app'));
  });

  it('local: uses local scope, and a repeated declaration is not an error', async () => {
    const fake = fakeClaude({ marketplaces: [], alreadyDeclared: true });
    const steps = await installPlugin({ ...baseOptions, scope: 'local', run: fake.run });

    assert.equal(fake.calls[0].args[fake.calls[0].args.indexOf('--scope') + 1], 'local');
    assert.equal(steps.length, 2);
    assert.equal(fake.calls[1].args.includes('install'), true);
  });

  it('runs nothing except the read-only list in a dry run', async () => {
    const fake = fakeClaude({ marketplaces: [] });
    const lines: string[] = [];
    const steps = await installPlugin({ ...baseOptions, scope: 'global', run: fake.run, dryRun: true, log: (line) => lines.push(line) });

    assert.deepEqual(fake.calls.map((call) => call.args), [['plugin', 'marketplace', 'list', '--json']]);
    assert.equal(steps.every((step) => step.ran === false), true);
    assert.match(lines[1], /would run: claude plugin install /);
  });

  it('stops with the claude error when a step fails', async () => {
    const fake = fakeClaude({ marketplaces: [], failOn: 'plugin install' });
    await assert.rejects(installPlugin({ ...baseOptions, scope: 'global', run: fake.run }), /claude plugin install .* failed \(exit 1\): boom/);
  });
});

describe('listInstalls', () => {
  it('maps user scope to global and keeps project and local folders', async () => {
    const fake = fakeClaude({
      plugins: [
        { id: 'other@x', scope: 'user', enabled: true },
        { id: PLUGIN_ID, scope: 'user', enabled: true },
        { id: PLUGIN_ID, scope: 'project', enabled: false, projectPath: 'D:/work/app' },
        { id: PLUGIN_ID, scope: 'local', enabled: true, projectPath: 'D:/work/other' },
      ],
    });
    assert.deepEqual(await listInstalls(fake.run), [
      { scope: 'global', enabled: true, projectPath: undefined },
      { scope: 'project', enabled: false, projectPath: 'D:/work/app' },
      { scope: 'local', enabled: true, projectPath: 'D:/work/other' },
    ]);
  });

  it('reports no installs when the plugin is absent', async () => {
    assert.deepEqual(await listInstalls(fakeClaude({ plugins: [] }).run), []);
  });
});

describe('uninstallPlugin', () => {
  const twoScopes = [
    { id: PLUGIN_ID, scope: 'user', enabled: true },
    { id: PLUGIN_ID, scope: 'project', enabled: true, projectPath: 'D:/work/app' },
  ];

  it('all: removes the global install and the install in this folder, each from its own folder', async () => {
    const fake = fakeClaude({ plugins: twoScopes });
    const removed = await uninstallPlugin({ scope: 'all', projectDir: 'D:/work/app', run: fake.run });

    assert.deepEqual(removed, ['global', 'project at D:/work/app']);
    const uninstalls = fake.calls.filter((call) => call.args[1] === 'uninstall');
    assert.deepEqual(uninstalls.map((call) => call.args), [
      ['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user'],
      ['plugin', 'uninstall', PLUGIN_ID, '--scope', 'project'],
    ]);
    assert.equal(uninstalls[1].cwd, 'D:/work/app');
  });

  it('all from another folder leaves that folder\'s project install alone', async () => {
    const fake = fakeClaude({ plugins: twoScopes });
    const removed = await uninstallPlugin({ scope: 'all', projectDir: 'D:/work/elsewhere', run: fake.run });

    assert.deepEqual(removed, ['global']);
  });

  it('project: only removes the project install in the given folder', async () => {
    const fake = fakeClaude({ plugins: twoScopes });
    const removed = await uninstallPlugin({ scope: 'project', projectDir: 'D:/work/app', run: fake.run });

    assert.deepEqual(removed, ['project at D:/work/app']);
    assert.equal(fake.calls.filter((call) => call.args[1] === 'uninstall').length, 1);
  });

  it('says so when nothing is installed in the chosen scope', async () => {
    await assert.rejects(uninstallPlugin({ scope: 'local', run: fakeClaude({ plugins: twoScopes }).run }), /not installed in the local scope/);
  });
});

describe('updatePlugin', () => {
  it('refreshes the marketplace once, then updates each selected install', async () => {
    const fake = fakeClaude({ plugins: [{ id: PLUGIN_ID, scope: 'user', enabled: true }] });
    const updated = await updatePlugin({ scope: 'all', run: fake.run });

    assert.deepEqual(updated, ['global']);
    assert.deepEqual(fake.calls.map((call) => call.args), [
      ['plugin', 'list', '--json'],
      ['plugin', 'marketplace', 'update', MARKETPLACE_NAME],
      ['plugin', 'update', PLUGIN_ID, '--scope', 'user'],
    ]);
  });
});
