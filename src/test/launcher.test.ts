import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pluginRoot = path.join(root, 'plugins/multi-account-netlify');

// The launcher is plain ESM with no build step. Importing it does not start the server.
const launcher = await import(pathToFileURL(path.join(pluginRoot, 'bin/launch.mjs')).href);

describe('the plugin launcher', () => {
  it('uses the installed command when it is on PATH, so the CLI and the plugin are the same copy', () => {
    assert.deepEqual(launcher.launchPlan({ version: '0.1.3', onPath: true, windows: false }), {
      command: 'multi-account-netlify-mcp',
      args: ['serve'],
      shell: false,
    });
  });

  it('runs the same version from npm with npx when the command is not installed', () => {
    assert.deepEqual(launcher.launchPlan({ version: '0.1.3', onPath: false, windows: false }), {
      command: 'npx',
      args: ['-y', 'multi-account-netlify-mcp@0.1.3', 'serve'],
      shell: false,
    });
  });

  it('starts commands through the shell on Windows, where npm installs .cmd shims', () => {
    assert.equal(launcher.launchPlan({ version: '0.1.3', onPath: true, windows: true }).shell, true);
    assert.equal(launcher.launchPlan({ version: '0.1.3', onPath: false, windows: true }).shell, true);
  });

  it('reads the version from the plugin manifest, and that version is the package version', () => {
    const version = launcher.pluginVersion(pluginRoot);
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(version, pkg.version);
  });
});
