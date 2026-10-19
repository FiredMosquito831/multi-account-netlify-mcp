import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Where the module keeps its own files. MULTI_ACCOUNT_NETLIFY_HOME overrides it (used by tests).
export const dataDir = (): string => {
  if (process.env.MULTI_ACCOUNT_NETLIFY_HOME) {
    return process.env.MULTI_ACCOUNT_NETLIFY_HOME;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'multi-account-netlify-mcp');
  }
  const xdgData = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  return path.join(xdgData, 'multi-account-netlify-mcp');
};

export const accountsFile = (): string => path.join(dataDir(), 'accounts.json');

// Throwaway CLI profile used while `netlify login` runs for one account.
export const loginProfileDir = (name: string): string => path.join(dataDir(), 'login-profiles', name);

// Empty per-account folder given to each official child as APPDATA/XDG_CONFIG_HOME,
// so the child can never read the user's own Netlify CLI login.
export const childIsolationDir = (name: string): string => path.join(dataDir(), 'children', name);

// Root of the installed package (the folder with package.json, .claude-plugin/ and plugins/).
// This file compiles to dist/paths.js, so the root is one level up.
export const packageRoot = (): string => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
