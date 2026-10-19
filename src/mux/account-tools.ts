import type { Tool } from '@modelcontextprotocol/client';
import { NAME_PATTERN, type Registry } from '../accounts/registry.js';

// Tools this server adds for the accounts themselves. They are not official tools: they never reach a Netlify
// child, and they take no account argument.
export const ACCOUNT_ADD_TOOL = 'account_add';
export const ACCOUNT_LIST_TOOL = 'account_list';

export const ACCOUNT_TOOLS: Tool[] = [
  {
    name: ACCOUNT_ADD_TOOL,
    description:
      'Add a Netlify account by logging in. A browser window opens with a new profile, and the user signs in there with ' +
      'the account to add. The call waits for that sign-in, for up to six minutes, and then the account is stored. ' +
      'The token goes to the operating system credential store and is never shown in the chat. ' +
      'Call this only when the user asks to add an account, and agree the name with them first. ' +
      'Tokens are not taken in the chat: the user adds one with `multi-account-netlify-mcp add <name> --pat` in a terminal. ' +
      'After a successful add, restart the agent so the new name shows in the account argument.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          pattern: NAME_PATTERN.source,
          description: 'A short name for the account, such as work or personal: lowercase letters, digits and hyphens, 1 to 32 characters.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: ACCOUNT_LIST_TOOL,
    description:
      'List the Netlify accounts set up on this computer: name, email, how each was added, and which one is the default. ' +
      'Tokens are never shown. This tool only reads.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// One line per account, as the terminal `list` command prints them. Tokens are not part of the record.
export const accountLines = (registry: Registry): string[] => {
  if (registry.accounts.length === 0) {
    return ['No accounts yet. Add one with the account_add tool, or run: multi-account-netlify-mcp add <name>'];
  }
  const lines = registry.accounts.map((account) => {
    const marker = account.name === registry.default ? '*' : ' ';
    return `${marker} ${account.name}\t${account.email}\t${account.source}`;
  });
  if (!registry.default) {
    lines.push('No default account. Calls must name one, or use "all".');
  }
  return lines;
};
