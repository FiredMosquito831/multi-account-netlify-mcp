import type { TokenStore } from '../secrets/token-store.js';
import type { NetlifyUser } from '../netlify/api.js';
import {
  addAccount as addAccountRecord,
  assertValidName,
  findAccount,
  loadRegistry,
  saveRegistry,
  type AccountRecord,
} from './registry.js';

export interface StoreDeps {
  file: string;
  tokens: TokenStore;
  fetchUser: (token: string) => Promise<NetlifyUser>;
}

export interface StoredAccount {
  account: AccountRecord;
  isDefault: boolean;
}

// Checks the token, then stores it and the account record. The token is removed again if the record
// cannot be saved, so a failed add leaves nothing behind. The same Netlify user cannot be added twice:
// the registry refuses it before anything is stored.
export const storeNewAccount = async (
  deps: StoreDeps,
  name: string,
  token: string,
  source: 'login' | 'pat',
): Promise<StoredAccount> => {
  const user = await deps.fetchUser(token);
  const updated = addAccountRecord(await loadRegistry(deps.file), {
    name,
    email: user.email,
    userId: user.id,
    source,
    addedAt: new Date().toISOString(),
  });

  deps.tokens.set(name, token);
  try {
    await saveRegistry(deps.file, updated);
  } catch (error) {
    deps.tokens.delete(name);
    throw error;
  }

  const account = findAccount(updated, name);
  if (!account) {
    throw new Error(`The account "${name}" was not saved.`);
  }
  return { account, isDefault: updated.default === name };
};

export interface InChatDeps extends StoreDeps {
  // Runs the browser login for a name and returns the token it got.
  login: (name: string) => Promise<{ token: string }>;
  // Names with a login still running. A second add for the same name waits for the first.
  pending: Set<string>;
}

// The account_add tool. Checks the name first, so a bad name or a taken name never opens a browser.
export const addAccountInChat = async (deps: InChatDeps, name: string): Promise<string> => {
  assertValidName(name);
  if (deps.pending.has(name)) {
    throw new Error(`A login for "${name}" is already running. Finish it in the browser first.`);
  }
  if (findAccount(await loadRegistry(deps.file), name)) {
    throw new Error(`An account named "${name}" already exists. Remove it first to replace it.`);
  }

  deps.pending.add(name);
  try {
    const { token } = await deps.login(name);
    const { account, isDefault } = await storeNewAccount(deps, name, token, 'login');
    const defaultNote = isDefault ? ' It is the default account.' : '';
    return `Added "${name}" (${account.email}).${defaultNote} Restart the agent so the new name shows in the account argument.`;
  } finally {
    deps.pending.delete(name);
  }
};
