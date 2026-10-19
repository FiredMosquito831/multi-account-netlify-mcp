import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MARKETPLACE_NAME, PLUGIN_NAME } from '../install/claude-plugin.js';

// Checks that the marketplace, plugin, launcher, commands and package.json agree with each other.
// Compiled tests run from dist/test, so the repo root is two levels up.
const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async (file: string) => JSON.parse(await readFile(path.join(root, file), 'utf8')) as Record<string, any>;

describe('plugin manifests', () => {
  it('the marketplace names match the installer constants', async () => {
    const marketplace = await readJson('.claude-plugin/marketplace.json');
    assert.equal(marketplace.name, MARKETPLACE_NAME);
    assert.deepEqual(
      marketplace.plugins.map((plugin: { name: string }) => plugin.name),
      [PLUGIN_NAME],
    );
  });

  it('every marketplace entry points at a plugin folder with a matching manifest', async () => {
    const marketplace = await readJson('.claude-plugin/marketplace.json');
    for (const entry of marketplace.plugins) {
      const manifest = await readJson(path.join(entry.source, '.claude-plugin/plugin.json'));
      assert.equal(manifest.name, entry.name);
      assert.equal(manifest.version, marketplace.metadata.version, 'marketplace and plugin versions differ');
    }
  });

  it('the plugin version matches package.json, so an npm update and a plugin refresh move together', async () => {
    const pkg = await readJson('package.json');
    const manifest = await readJson(`plugins/${PLUGIN_NAME}/.claude-plugin/plugin.json`);
    const marketplace = await readJson('.claude-plugin/marketplace.json');
    assert.equal(manifest.version, pkg.version);
    assert.equal(marketplace.metadata.version, pkg.version);
  });

  it('the MCP launcher reads cli_path, and the plugin declares it as a required setting', async () => {
    const manifest = await readJson(`plugins/${PLUGIN_NAME}/.claude-plugin/plugin.json`);
    const mcp = await readJson(`plugins/${PLUGIN_NAME}/.mcp.json`);
    const server = mcp.mcpServers.netlify;
    assert.equal(server.command, 'node');
    assert.ok(server.args.includes('${user_config.cli_path}'));
    assert.ok(server.args.includes('serve'));
    assert.equal(manifest.userConfig.cli_path.required, true);
  });

  it('the launcher points at the built CLI that the package bin exposes', async () => {
    const pkg = await readJson('package.json');
    assert.equal(pkg.bin['multi-account-netlify-mcp'], './dist/cli.js');
    const cliSource = await readFile(path.join(root, 'src/cli.ts'), 'utf8');
    assert.match(cliSource, /^#!\/usr\/bin\/env node/);
  });

  it('every command has a description and uses only the CLI in its Bash allowance', async () => {
    const dir = path.join(root, `plugins/${PLUGIN_NAME}/commands`);
    const files = (await readdir(dir)).filter((file) => file.endsWith('.md'));
    assert.ok(files.length >= 5);
    for (const file of files) {
      const text = await readFile(path.join(dir, file), 'utf8');
      assert.match(text, /^---\ndescription: .+\n/, `${file} needs a description`);
      assert.match(text, /allowed-tools: Bash\(multi-account-netlify-mcp:\*\)/, `${file} allowance`);
    }
  });

  it('remove-account does not run the removal from injected output before the user confirms', async () => {
    const text = await readFile(path.join(root, `plugins/${PLUGIN_NAME}/commands/remove-account.md`), 'utf8');
    assert.doesNotMatch(text, /!`multi-account-netlify-mcp remove/);
    assert.match(text, /confirm/i);
  });

  it('the skill name matches its folder', async () => {
    const text = await readFile(path.join(root, `plugins/${PLUGIN_NAME}/skills/netlify-accounts/SKILL.md`), 'utf8');
    assert.match(text, /^---\nname: netlify-accounts\n/);
  });

  it('the package ships the marketplace, plugin and README', async () => {
    const pkg = await readJson('package.json');
    for (const entry of ['dist', '.claude-plugin', 'plugins', 'README.md']) {
      assert.ok(pkg.files.some((file: string) => file === entry || file.startsWith(`${entry}/`)), `files lacks ${entry}`);
    }
  });
});
