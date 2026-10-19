import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { loginProfileDir } from '../paths.js';

const require = createRequire(import.meta.url);

// Where the Netlify CLI keeps config.json for each platform, relative to the profile folder
// we point it at. Windows uses APPDATA, Linux XDG_CONFIG_HOME, macOS HOME.
export const cliConfigCandidates = (profileDir: string): string[] => [
  path.join(profileDir, 'netlify', 'Config', 'config.json'),
  path.join(profileDir, 'netlify', 'config.json'),
  path.join(profileDir, 'Library', 'Preferences', 'netlify', 'config.json'),
];

export interface CliLogin {
  token: string;
  userId: string;
}

// Reads the token the CLI wrote for the user it just logged in.
export const readCliLogin = async (profileDir: string): Promise<CliLogin> => {
  for (const file of cliConfigCandidates(profileDir)) {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const config = JSON.parse(raw) as { userId?: unknown; users?: Record<string, { auth?: { token?: unknown } }> };
    if (typeof config.userId !== 'string') {
      continue;
    }
    const token = config.users?.[config.userId]?.auth?.token;
    if (typeof token === 'string' && token.length > 0) {
      return { token, userId: config.userId };
    }
  }
  throw new Error('netlify login finished but did not write a token to the login profile.');
};

// Environment for a CLI run that must not touch the user's own login. APPDATA, XDG_CONFIG_HOME
// and HOME all point at the profile, so the CLI cannot read or merge ~/.netlify/config.json.
export const isolatedEnv = (profileDir: string): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.NETLIFY_AUTH_TOKEN;
  delete env.NETLIFY_PERSONAL_ACCESS_TOKEN;
  return {
    ...env,
    APPDATA: profileDir,
    LOCALAPPDATA: profileDir,
    XDG_CONFIG_HOME: profileDir,
    HOME: profileDir,
    USERPROFILE: profileDir,
  };
};

// Path to the netlify-cli entry script, from the version pinned in package.json.
export const netlifyCliEntry = (): string => {
  const packageJsonPath = require.resolve('netlify-cli/package.json');
  const pkg = require(packageJsonPath) as { bin: Record<string, string> };
  return path.join(path.dirname(packageJsonPath), pkg.bin.netlify);
};

const runNetlifyLogin = (profileDir: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [netlifyCliEntry(), 'login'], {
      env: isolatedEnv(profileDir),
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`netlify login exited with code ${code}.`));
      }
    });
  });

// Runs `netlify login` in a throwaway profile and returns the token. The profile is deleted
// afterwards, so the token only lives in memory and in the credential store.
export const loginWithNetlifyCli = async (name: string): Promise<CliLogin> => {
  const profileDir = loginProfileDir(name);
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  try {
    await runNetlifyLogin(profileDir);
    return await readCliLogin(profileDir);
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
};
