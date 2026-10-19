import type { Tool } from '@modelcontextprotocol/client';

// Tools that never call the Netlify API, so they take no account.
// netlify-coding-rules is registered by the official server in netlify-mcp.ts.
export const NO_ACCOUNT_TOOLS: ReadonlySet<string> = new Set(['netlify-coding-rules']);

const accountDescription = (names: string[]): string =>
  `Netlify account to use: one name, several names separated by commas, or "all". ` +
  `Leave out to use the default account. Accounts: ${names.length > 0 ? names.join(', ') : 'none yet'}.`;

// Adds the `account` argument to a tool from the official server. The original tool is not mutated.
export const withAccountParam = (tool: Tool, accountNames: string[]): Tool => {
  if (NO_ACCOUNT_TOOLS.has(tool.name)) {
    return tool;
  }
  const schema = tool.inputSchema;
  return {
    ...tool,
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
