import { Entry } from '@napi-rs/keyring';

// One Credential Manager entry per account. The service name groups them together.
const SERVICE = 'multi-account-netlify-mcp';

export interface TokenStore {
  get(account: string): string | null;
  set(account: string, token: string): void;
  delete(account: string): boolean;
}

// Windows Credential Manager on Windows, Keychain on macOS, Secret Service on Linux.
export const osTokenStore: TokenStore = {
  get: (account) => new Entry(SERVICE, account).getPassword(),
  set: (account, token) => new Entry(SERVICE, account).setPassword(token),
  delete: (account) => new Entry(SERVICE, account).deletePassword(),
};
