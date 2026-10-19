import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MARKETPLACE_NAME,
  PLUGIN_ID,
  installPlugin,
  pluginStatus,
  uninstallPlugin,
  updatePlugin,
  type ClaudeRunner,
  type RunResult,
} from '../install/claude-plugin.js';

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });

// Records every call and answers from a script. The real `claude` CLI is never started.
const fakeClaude = (answers: { marketplaces?: string[]; plugins?: unknown[]; failOn?: string } = {}) => {
  const calls: string[][] = [];
  const run: ClaudeRunner = async (args) => {
    calls.push([...args]);
    const line = args.join(' ');
    if (answers.failOn && line.includes(answers.failOn)) {
      return { code: 1, stdout: '', stderr: `boom: ${answers.failOn}` };
    }
    if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
      return ok(JSON.stringify((answers.marketplaces ?? []).map((name) => ({ name }))));
    }
    if (args[0] === 'plugin' && args[1] === 'list') {
      return ok(JSON.stringify(answers.plugins ?? []));
    }
    return ok();
  };
  return { run, calls };
};

const baseOptions = {
  scope: 'user' as const,
  source: 'D:/npm/node_modules/multi-account-netlify-mcp',
  cliPath: 'D:/npm/node_modules/multi-account-netlify-mcp/dist/cli.js',
};

describe('installPlugin', () => {
  it('adds the marketplace from the package folder, then installs with the cli_path setting', async () => {
    const fake = fakeClaude({ marketplaces: [] });
    await installPlugin({ ...baseOptions, run: fake.run });

    assert.deepEqual(fake.calls, [
      ['plugin', 'marketplace', 'list', '--json'],
      ['plugin', 'marketplace', 'add', baseOptions.source, '--scope', 'user'],
      ['plugin', 'install', PLUGIN_ID, '--scope', 'user', '--config', `cli_path=${baseOptions.cliPath}`],
    ]);
  });

  it('refreshes the marketplace instead of adding it twice when it is already registered', async () => {
    const fake = fakeClaude({ marketplaces: [MARKETPLACE_NAME, 'other'] });
    await installPlugin({ ...baseOptions, run: fake.run });

    assert.deepEqual(fake.calls[1], ['plugin', 'marketplace', 'update', MARKETPLACE_NAME]);
    assert.equal(fake.calls.filter((args) => args.includes('add')).length, 0);
  });

  it('runs nothing except the read-only list in a dry run', async () => {
    const fake = fakeClaude({ marketplaces: [] });
    const lines: string[] = [];
    const steps = await installPlugin({ ...baseOptions, run: fake.run, dryRun: true, log: (line) => lines.push(line) });

    assert.deepEqual(fake.calls, [['plugin', 'marketplace', 'list', '--json']]);
    assert.equal(steps.every((step) => step.ran === false), true);
    assert.equal(lines.length, 2);
    assert.match(lines[1], /would run: claude plugin install /);
  });

  it('stops with the claude error when a step fails', async () => {
    const fake = fakeClaude({ marketplaces: [], failOn: 'plugin install' });
    await assert.rejects(installPlugin({ ...baseOptions, run: fake.run }), /claude plugin install .* failed \(exit 1\): boom/);
  });

  it('installs into project scope when asked', async () => {
    const fake = fakeClaude({ marketplaces: [] });
    await installPlugin({ ...baseOptions, scope: 'project', run: fake.run });

    assert.deepEqual(fake.calls[1], ['plugin', 'marketplace', 'add', baseOptions.source, '--scope', 'project']);
    assert.equal(fake.calls[2][fake.calls[2].indexOf('--scope') + 1], 'project');
  });
});

describe('updatePlugin and uninstallPlugin', () => {
  it('refreshes the marketplace, then updates the plugin', async () => {
    const fake = fakeClaude();
    await updatePlugin({ scope: 'user', run: fake.run });
    assert.deepEqual(fake.calls, [
      ['plugin', 'marketplace', 'update', MARKETPLACE_NAME],
      ['plugin', 'update', PLUGIN_ID, '--scope', 'user'],
    ]);
  });

  it('uninstalls the plugin only, keeping accounts and tokens', async () => {
    const fake = fakeClaude();
    await uninstallPlugin({ scope: 'user', run: fake.run });
    assert.deepEqual(fake.calls, [['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user']]);
  });
});

describe('pluginStatus', () => {
  it('reports installed and enabled from the plugin list', async () => {
    const fake = fakeClaude({ plugins: [{ id: 'other@x', enabled: true }, { id: PLUGIN_ID, enabled: true, installPath: '/cache/p' }] });
    assert.deepEqual(await pluginStatus(fake.run), { installed: true, enabled: true, installPath: '/cache/p' });
  });

  it('reports not installed when the plugin is absent', async () => {
    const fake = fakeClaude({ plugins: [] });
    assert.deepEqual(await pluginStatus(fake.run), { installed: false, enabled: false });
  });

  it('reports a disabled plugin as installed but not enabled', async () => {
    const fake = fakeClaude({ plugins: [{ id: PLUGIN_ID, enabled: false }] });
    assert.deepEqual(await pluginStatus(fake.run), { installed: true, enabled: false, installPath: undefined });
  });

  it('says so when the claude CLI cannot be started', async () => {
    const run: ClaudeRunner = async () => {
      throw new Error('Could not start "claude".');
    };
    assert.equal(await pluginStatus(run), 'no-claude');
  });
});
