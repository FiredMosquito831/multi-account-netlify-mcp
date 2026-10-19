import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client, type CallToolResult } from '@modelcontextprotocol/client';
import { withAccountParam } from '../mux/catalog.js';
import { OfficialChild, officialEntry } from '../mux/official-child.js';
import { VERSION } from '../version.js';

// These tests run the real @netlify/mcp package, so they check the contract this module relies on.
// If an official update breaks it, these fail before the update is used.
const LONG = { timeout: 120_000 };

describe('official @netlify/mcp contract', () => {
  it('ships the entry script we spawn', LONG, async () => {
    await access(officialEntry());
  });

  it('exposes the coding-rules tool and a reader and updater per domain', LONG, async () => {
    const child = await OfficialChild.start('it-catalog');
    try {
      const names = (await child.listTools()).map((tool) => tool.name);
      assert.ok(names.includes('netlify-coding-rules'));
      for (const domain of ['user', 'deploy', 'team', 'project', 'extension', 'observability']) {
        assert.ok(names.includes(`netlify-${domain}-services-reader`), `missing reader for ${domain}`);
      }
    } finally {
      await child.close();
    }
  });

  it('gives every tool an object schema that accepts the account argument', LONG, async () => {
    const child = await OfficialChild.start('it-schema');
    try {
      for (const tool of await child.listTools()) {
        const withAccount = withAccountParam(tool, ['work']);
        assert.equal(withAccount.inputSchema.type, 'object', tool.name);
        if (tool.name !== 'netlify-coding-rules') {
          assert.ok((withAccount.inputSchema.properties as Record<string, unknown>).account, tool.name);
        }
      }
    } finally {
      await child.close();
    }
  });

  it('runs the coding-rules tool with no token and no network', LONG, async () => {
    const child = await OfficialChild.start('it-rules');
    try {
      const result: CallToolResult = await child.callTool('netlify-coding-rules', {
        creationType: 'netlify-access-control',
      });
      assert.notEqual(result.isError, true);
      assert.ok(result.content.length > 0);
    } finally {
      await child.close();
    }
  });

  it('reports a bad token as an error instead of hanging', LONG, async () => {
    const child = await OfficialChild.start('it-bad-token', 'nfp_not_a_real_token');
    try {
      let failed = false;
      try {
        const result = await child.callTool('netlify-user-services-reader', {
          selectSchema: { operation: 'get-user' },
        });
        failed = result.isError === true;
      } catch {
        failed = true;
      }
      assert.equal(failed, true);
    } finally {
      await child.close();
    }
  });
});

describe('serve command, end to end over stdio', () => {
  it('lists tools with the account argument and routes calls like the real client would', LONG, async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'serve-e2e-'));
    try {
      // One account is registered, but no token is stored for it. Listing and the no-network tool still work.
      await writeFile(
        path.join(home, 'accounts.json'),
        JSON.stringify({
          default: 'work',
          accounts: [{ name: 'work', email: 'work@example.com', userId: 'u-work', source: 'login', addedAt: '2026-10-19T00:00:00.000Z' }],
        }),
        'utf8',
      );
      const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [cli],
        env: { MULTI_ACCOUNT_NETLIFY_HOME: home },
        stderr: 'pipe',
      });
      const client = new Client({ name: 'e2e-test', version: VERSION }, { capabilities: {} });
      await client.connect(transport);
      try {
        const { tools } = await client.listTools();
        const reader = tools.find((tool) => tool.name === 'netlify-project-services-reader');
        assert.ok(reader, 'official reader tool is visible');
        const accountSchema = (reader!.inputSchema.properties as Record<string, { description: string }>).account;
        assert.match(accountSchema.description, /Accounts: work/);

        const rules = (await client.callTool({
          name: 'netlify-coding-rules',
          arguments: { creationType: 'netlify-access-control' },
        })) as CallToolResult;
        assert.notEqual(rules.isError, true);

        const noToken = (await client.callTool({
          name: 'netlify-project-services-reader',
          arguments: { account: 'work', selectSchema: { operation: 'get-project' } },
        })) as CallToolResult;
        assert.equal(noToken.isError, true);
        assert.match((noToken.content[0] as { text: string }).text, /No stored token for account "work"/);
      } finally {
        await client.close();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
