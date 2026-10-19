import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IN_CHAT_LOGIN_TIMEOUT_MS, describeCliFailure } from '../login/netlify-cli-login.js';

describe('the in-chat login', () => {
  it('waits six minutes for the sign-in, the same limit the official server uses', () => {
    assert.equal(IN_CHAT_LOGIN_TIMEOUT_MS, 6 * 60 * 1000);
  });
});

describe('the reason a login failed', () => {
  it('is the last line the CLI printed, with the exit code', () => {
    const output = 'Logging into your Netlify account...\nWaiting for the sign-in\nError: the sign-in was denied\n';
    assert.equal(describeCliFailure(output, 1), 'netlify login exited with code 1: Error: the sign-in was denied');
  });

  it('never shows a login link, because a link is a sign-in ticket', () => {
    const output = 'Logging into your Netlify account...\nVisit https://app.netlify.com/cli/login?ticket=abc123\n';
    const message = describeCliFailure(output, 1);
    assert.doesNotMatch(message, /https?:\/\//);
    assert.doesNotMatch(message, /ticket=/);
  });

  it('says only the exit code when the CLI printed nothing', () => {
    assert.equal(describeCliFailure('', 2), 'netlify login exited with code 2.');
  });
});
