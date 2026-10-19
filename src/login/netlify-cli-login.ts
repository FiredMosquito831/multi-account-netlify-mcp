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

// The most the server keeps of a captured run. A login prints a few lines, so this is never reached in practice.
const MAX_CAPTURED_OUTPUT = 16_384;

// The in-chat login waits this long for the browser sign-in, the same limit the official server uses.
export const IN_CHAT_LOGIN_TIMEOUT_MS = 6 * 60_000;

interface LoginRun {
  code: number | null;
  output: string;
  timedOut: boolean;
}

// Runs `netlify login` and waits until it has exited. A captured run keeps its output and never writes to
// this process's stdout, which is the MCP channel while the server runs. On a timeout the CLI is stopped,
// and the wait goes on until it has actually exited, so its files are not touched while it still holds them.
const runNetlifyLogin = (env: NodeJS.ProcessEnv, options: { capture: boolean; timeoutMs?: number }): Promise<LoginRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [netlifyCliEntry(), 'login'], {
      env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    const keep = (chunk: Buffer) => {
      if (output.length < MAX_CAPTURED_OUTPUT) {
        output += chunk.toString('utf8');
      }
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);

    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });

// One line that says why the CLI failed, without any link. A login link is a sign-in ticket, so it is never shown.
export const describeCliFailure = (output: string, code: number | null): string => {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/https?:\/\/\S+/g, '<link>').trim())
    .filter((line) => line.length > 0);
  const last = lines.at(-1);
  return last ? `netlify login exited with code ${code}: ${last}` : `netlify login exited with code ${code}.`;
};

// Removes the login profile. The file that holds the token goes first, so a browser that still has the folder
// open cannot leave the token on disk (Windows keeps those files locked). A failed clean-up is not an error:
// the login has already succeeded or failed.
const forgetProfile = async (profileDir: string): Promise<void> => {
  for (const file of cliConfigCandidates(profileDir)) {
    await rm(file, { force: true }).catch(() => undefined);
  }
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
};

const startFresh = async (profileDir: string): Promise<void> => {
  await forgetProfile(profileDir);
  await mkdir(profileDir, { recursive: true });
};

// Runs `netlify login` in a throwaway profile, in this terminal, and returns the token. The profile is
// deleted afterwards, so the token only lives in memory and in the credential store.
export const loginWithNetlifyCli = async (name: string): Promise<CliLogin> => {
  const profileDir = loginProfileDir(name);
  await startFresh(profileDir);
  try {
    const run = await runNetlifyLogin(isolatedEnv(profileDir), { capture: false });
    if (run.code !== 0) {
      throw new Error(describeCliFailure(run.output, run.code));
    }
    return await readCliLogin(profileDir);
  } finally {
    await forgetProfile(profileDir);
  }
};

// The browser login behind the account_add tool. It is the same `netlify login`, with the login source set to
// mcp, as the official server uses. The call waits for the sign-in, for up to six minutes.
export const loginInChat = async (name: string): Promise<CliLogin> => {
  const profileDir = loginProfileDir(name);
  await startFresh(profileDir);
  try {
    const env = { ...isolatedEnv(profileDir), NETLIFY_LOGIN_SOURCE: 'mcp' };
    const run = await runNetlifyLogin(env, { capture: true, timeoutMs: IN_CHAT_LOGIN_TIMEOUT_MS });
    if (run.timedOut) {
      throw new Error(
        'The Netlify login was not finished within six minutes. Try again, or run `multi-account-netlify-mcp add <name>` in a terminal.',
      );
    }
    if (run.code !== 0) {
      throw new Error(
        `${describeCliFailure(run.output, run.code)} Try again, or run \`multi-account-netlify-mcp add <name>\` in a terminal.`,
      );
    }
    return await readCliLogin(profileDir);
  } finally {
    await forgetProfile(profileDir);
  }
};
