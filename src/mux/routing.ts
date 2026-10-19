import type { Registry } from '../accounts/registry.js';

export interface Targets {
  accounts: string[];
  // True for "all" and for comma lists. Those return one entry per account instead of
  // passing a single account's result through unchanged.
  multi: boolean;
}

// Turns the `account` argument into the accounts a tool call should run on.
export const resolveTargets = (raw: unknown, registry: Registry): Targets => {
  const names = registry.accounts.map((account) => account.name);
  if (names.length === 0) {
    throw new Error('No Netlify accounts are set up yet. Run: multi-account-netlify-mcp add <name>');
  }
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw new Error('account must be a string: one name, comma-separated names, or "all".');
  }

  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') {
    if (registry.default) {
      return { accounts: [registry.default], multi: false };
    }
    if (names.length === 1) {
      return { accounts: [names[0]], multi: false };
    }
    throw new Error(`No default account is set. Pass account as one of: ${names.join(', ')}, or "all".`);
  }

  if (value === 'all') {
    return { accounts: names, multi: true };
  }

  const requested = [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
  const unknown = requested.filter((name) => !names.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown account${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Known accounts: ${names.join(', ')}.`);
  }
  return { accounts: requested, multi: value.includes(',') };
};
