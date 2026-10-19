import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Account names become part of the Credential Manager target and of tool arguments, so keep them plain.
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface AccountRecord {
  name: string;
  email: string;
  userId: string;
  source: 'login' | 'pat';
  addedAt: string;
}

// Holds metadata only. Tokens live in the OS credential store, never in this file.
export interface Registry {
  default?: string;
  accounts: AccountRecord[];
}

export const emptyRegistry = (): Registry => ({ accounts: [] });

// "all" is the fan-out keyword in the `account` argument, so it cannot be a name.
const RESERVED_NAMES: ReadonlySet<string> = new Set(['all']);

export const assertValidName = (name: string): void => {
  if (RESERVED_NAMES.has(name)) {
    throw new Error(`"${name}" is reserved. Pick another account name.`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid account name "${name}". Use 1-32 lowercase letters, digits or hyphens, starting with a letter or digit.`,
    );
  }
};

export const findAccount = (registry: Registry, name: string): AccountRecord | undefined =>
  registry.accounts.find((account) => account.name === name);

export const addAccount = (registry: Registry, record: AccountRecord): Registry => {
  assertValidName(record.name);
  if (findAccount(registry, record.name)) {
    throw new Error(`An account named "${record.name}" already exists. Remove it first to replace it.`);
  }
  const sameLogin = registry.accounts.find((account) => account.userId === record.userId);
  if (sameLogin) {
    throw new Error(`This Netlify login is already added as "${sameLogin.name}".`);
  }
  const accounts = [...registry.accounts, record];
  return { ...registry, accounts, default: registry.default ?? (accounts.length === 1 ? record.name : undefined) };
};

export const removeAccount = (registry: Registry, name: string): Registry => {
  if (!findAccount(registry, name)) {
    throw new Error(`No account named "${name}".`);
  }
  const accounts = registry.accounts.filter((account) => account.name !== name);
  const defaultName = registry.default === name ? undefined : registry.default;
  return { ...registry, accounts, default: defaultName };
};

export const setDefaultAccount = (registry: Registry, name: string): Registry => {
  if (!findAccount(registry, name)) {
    throw new Error(`No account named "${name}".`);
  }
  return { ...registry, default: name };
};

export const loadRegistry = async (file: string): Promise<Registry> => {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyRegistry();
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as Registry;
  return { default: parsed.default, accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [] };
};

// Write to a temp file and rename, so a crash never leaves a half-written registry.
export const saveRegistry = async (file: string, registry: Registry): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await rename(temp, file);
};
