import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { isolatedEnv, readCliLogin } from '../login/netlify-cli-login.js';
import { childEnv } from '../mux/official-child.js';

const writeConfig = async (file: string, config: unknown) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(config), 'utf8');
};

const cliConfig = (userId: string, token: string) => ({
  userId,
  users: { [userId]: { id: userId, email: 'me@example.com', auth: { token, github: {} } } },
});

describe('readCliLogin', () => {
  let profile: string;
  beforeEach(async () => {
    profile = await mkdtemp(path.join(tmpdir(), 'profile-test-'));
  });
  afterEach(async () => {
    await rm(profile, { recursive: true, force: true });
  });

  it('reads the Windows layout (APPDATA\\netlify\\Config\\config.json)', async () => {
    await writeConfig(path.join(profile, 'netlify', 'Config', 'config.json'), cliConfig('u1', 'nfp_win'));
    assert.deepEqual(await readCliLogin(profile), { token: 'nfp_win', userId: 'u1' });
  });

  it('reads the Linux layout (XDG_CONFIG_HOME\\netlify\\config.json)', async () => {
    await writeConfig(path.join(profile, 'netlify', 'config.json'), cliConfig('u2', 'nfp_linux'));
    assert.deepEqual(await readCliLogin(profile), { token: 'nfp_linux', userId: 'u2' });
  });

  it('fails when the CLI wrote no token for the logged-in user', async () => {
    await writeConfig(path.join(profile, 'netlify', 'Config', 'config.json'), { userId: 'u3', users: {} });
    await assert.rejects(readCliLogin(profile), /did not write a token/);
  });

  it('fails when no config file exists at all', async () => {
    await assert.rejects(readCliLogin(profile), /did not write a token/);
  });
});

describe('isolatedEnv', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ['NETLIFY_AUTH_TOKEN', 'NETLIFY_PERSONAL_ACCESS_TOKEN'];
  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      process.env[key] = 'from-parent';
    }
  });
  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('points the CLI at the profile folder and drops inherited Netlify tokens', () => {
    const env = isolatedEnv('D:/profile');
    assert.equal(env.APPDATA, 'D:/profile');
    assert.equal(env.HOME, 'D:/profile');
    assert.equal(env.USERPROFILE, 'D:/profile');
    assert.equal(env.NETLIFY_AUTH_TOKEN, undefined);
    assert.equal(env.NETLIFY_PERSONAL_ACCESS_TOKEN, undefined);
  });
});

describe('childEnv', () => {
  it('gives the official child its token and an isolated config folder', () => {
    const env = childEnv('D:/children/work', 'nfp_work');
    assert.equal(env.NETLIFY_PERSONAL_ACCESS_TOKEN, 'nfp_work');
    assert.equal(env.APPDATA, 'D:/children/work');
    assert.equal(env.HOME, 'D:/children/work');
  });

  it('sets no token when none is given, so the child cannot fall back to a login', () => {
    const env = childEnv('D:/children/_catalog');
    assert.equal('NETLIFY_PERSONAL_ACCESS_TOKEN' in env, false);
    assert.equal('NETLIFY_AUTH_TOKEN' in env, false);
  });
});
