import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { USAGE, commandWhenNone } from '../usage.js';

describe('the command with no arguments', () => {
  it('shows the help in a terminal', () => {
    assert.equal(commandWhenNone(true), 'help');
  });

  it('starts the server when stdin is a pipe, as an agent starts it', () => {
    assert.equal(commandWhenNone(false), 'serve');
  });
});

describe('the help text', () => {
  it('shows the server start command', () => {
    assert.match(USAGE, /Server start command: multi-account-netlify-mcp serve/);
  });

  it('says the agents start the server, and that running it by hand only waits for a client', () => {
    assert.match(USAGE, /The agents start it for you/);
    assert.match(USAGE, /waits for an MCP\s+client on stdin/);
  });

  it('names the in-chat account tool next to the terminal add command', () => {
    assert.match(USAGE, /account_add tool/);
  });
});
