import type { Tool } from '@modelcontextprotocol/client';
import { MIXED_OPERATIONS, modeFor, type Mode } from './policy.js';

// Tools that never call the Netlify API, so they take no account.
// netlify-coding-rules is registered by the official server in netlify-mcp.ts.
export const NO_ACCOUNT_TOOLS: ReadonlySet<string> = new Set(['netlify-coding-rules']);

const MODE_TEXT: Record<Mode, string> = {
  all: 'every named account answers',
  locate: 'only the account that owns the id answers, and accounts without it are listed under notFoundIn',
  one: 'one account only, so a list or all is refused',
};

// Mixed operations read and change data, so each part is described separately.
const MIXED_TEXT: Record<string, string> = {
  'manage-env-vars':
    'manage-env-vars: listing needs the account that owns the site (only it answers); creating, updating and deleting need one account',
  'manage-form-submissions':
    'manage-form-submissions: get-submissions needs the account that owns the form (only it answers); delete-submission needs one account',
};

// The operation names a grouped selector tool can run, read from its schema.
export const operationsOf = (tool: Tool): string[] => {
  const selector = tool.inputSchema?.properties?.selectSchema as Record<string, unknown> | undefined;
  const variants = (selector?.anyOf as Record<string, any>[] | undefined) ?? (selector ? [selector] : []);
  return variants
    .map((variant) => variant?.properties?.operation?.const)
    .filter((operation): operation is string => typeof operation === 'string');
};

// One paragraph for the tool description: how each of its operations can use several accounts.
export const multiAccountNote = (tool: Tool): string => {
  const operations = operationsOf(tool);
  if (operations.length === 0) {
    return '';
  }
  const parts = operations.map((operation) =>
    MIXED_OPERATIONS.has(operation) ? MIXED_TEXT[operation] : `${operation}: ${MODE_TEXT[modeFor(operation)]}`,
  );
  return `Multi-account (the account argument): ${parts.join('; ')}.`;
};

const accountDescription = (names: string[]): string =>
  'Netlify account to use: one name, several names separated by commas, or "all". ' +
  'Lists and all only work for operations that allow them; changes need one name. ' +
  `Leave out to use the default account. Accounts: ${names.length > 0 ? names.join(', ') : 'none yet'}.`;

// Adds the `account` argument to a tool from the official server, and the multi-account rules to its
// description, so every agent sees them without a skill. The original tool is not mutated.
export const withAccountParam = (tool: Tool, accountNames: string[]): Tool => {
  if (NO_ACCOUNT_TOOLS.has(tool.name)) {
    return tool;
  }
  const schema = tool.inputSchema;
  const note = multiAccountNote(tool);
  return {
    ...tool,
    description: [tool.description, note].filter((part) => part !== undefined && part !== '').join('\n\n'),
    inputSchema: {
      ...schema,
      type: 'object',
      properties: {
        ...(schema.properties ?? {}),
        account: { type: 'string', description: accountDescription(accountNames) },
      },
    },
  };
};
