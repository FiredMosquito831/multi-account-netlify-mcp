import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Tool } from '@modelcontextprotocol/client';
import { withAccountParam } from '../mux/catalog.js';

const domainTool: Tool = {
  name: 'netlify-project-services-reader',
  description: 'Reads project data',
  inputSchema: {
    type: 'object',
    properties: { selectSchema: { type: 'object', properties: { operation: { type: 'string' } } } },
    required: ['selectSchema'],
  },
  annotations: { readOnlyHint: true },
};

const codingRules: Tool = {
  name: 'netlify-coding-rules',
  inputSchema: { type: 'object', properties: { creationType: { type: 'string' } } },
};

describe('withAccountParam', () => {
  it('adds an account property and keeps the tool\'s own properties and required list', () => {
    const tool = withAccountParam(domainTool, ['work', 'personal']);
    const properties = tool.inputSchema.properties as Record<string, { type: string; description: string }>;
    assert.ok(properties.selectSchema, 'existing property kept');
    assert.equal(properties.account.type, 'string');
    assert.match(properties.account.description, /work, personal/);
    assert.deepEqual(tool.inputSchema.required, ['selectSchema']);
  });

  it('does not modify the tool it was given', () => {
    const before = JSON.stringify(domainTool);
    withAccountParam(domainTool, ['work']);
    assert.equal(JSON.stringify(domainTool), before);
  });

  it('leaves the coding-rules tool alone, since it never calls Netlify', () => {
    assert.equal(withAccountParam(codingRules, ['work']), codingRules);
  });

  it('says so when no accounts exist yet', () => {
    const tool = withAccountParam(domainTool, []);
    const properties = tool.inputSchema.properties as Record<string, { description: string }>;
    assert.match(properties.account.description, /none yet/);
  });
});
