import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../paths.js';
import type { AgentId, AgentScope } from './types.js';

// What an install wrote, per agent and scope. Uninstall removes only these entries, so a server or
// instruction that the user added by hand is never touched.
export interface Recorded {
  kind: 'mcp-entry' | 'json-instruction' | 'toml-table' | 'directory';
  // Where it was written (a config file or a folder), and the key or name inside it.
  path: string;
  name?: string;
}

interface StateFile {
  [scopeKey: string]: Recorded[];
}

const stateFile = (agent: AgentId): string => path.join(dataDir(), 'state', `${agent}.json`);

// "global", or "project:<folder>" / "local:<folder>". Folder comparisons are case-insensitive on Windows.
export const scopeKey = (scope: AgentScope, projectDir: string): string => {
  if (scope === 'global') {
    return 'global';
  }
  const folder = path.resolve(projectDir);
  return `${scope}:${process.platform === 'win32' ? folder.toLowerCase() : folder}`;
};

export const readState = (agent: AgentId): StateFile => {
  const file = stateFile(agent);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StateFile) : {};
};

const writeState = async (agent: AgentId, state: StateFile): Promise<void> => {
  await mkdir(path.dirname(stateFile(agent)), { recursive: true });
  await writeFile(stateFile(agent), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
};

export const recordedItems = (agent: AgentId, key: string): Recorded[] => readState(agent)[key] ?? [];

export const record = async (agent: AgentId, key: string, item: Recorded): Promise<void> => {
  const state = readState(agent);
  const items = (state[key] ?? []).filter((existing) => JSON.stringify(existing) !== JSON.stringify(item));
  state[key] = [...items, item];
  await writeState(agent, state);
};

export const forget = async (agent: AgentId, key: string): Promise<void> => {
  const state = readState(agent);
  if (key in state) {
    delete state[key];
    await writeState(agent, state);
  }
};

// Reads a text file if it exists. Used so an adapter can say "not there" without throwing.
export const readIfExists = async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};
