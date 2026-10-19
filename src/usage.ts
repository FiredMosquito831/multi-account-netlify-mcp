export const USAGE = `multi-account-netlify-mcp <command>

Commands:
  add <name> [--pat]   Add a Netlify account. Runs \`netlify login\` in a separate profile, so a browser
                       window opens for the sign-in. With --pat, asks for a personal access token instead.
                       In a chat, the account_add tool does the browser login.
  list                 Show the accounts. Tokens are never printed.
  default <name>       Set the account used when a tool call names none.
  remove <name>        Remove an account and its stored token.
  doctor               Check the data folder, the official server, the agents and each account's token.
  install [agent ...] [--scope global|project|local] [--project-dir DIR] [--source SRC] [--dry-run] [--yes]
                       Install into the agents you name: claude, codex, opencode, antigravity, or all.
                       With no agent named, every agent set up here. In a terminal, missing answers are asked
                       for, and the exact command is shown before anything is written.
                       global (default) is for every folder. project is shared through git. local is this folder only.
  update [agent ...] [--scope global|project|local|all] [--project-dir DIR]
                       Refresh the installs that exist (default: all scopes). Run
                       \`npm install -g multi-account-netlify-mcp@latest\` first to update the code.
  uninstall [agent ...] [--scope global|project|local|all] [--project-dir DIR]
                       Remove this server from the agents (default: all scopes). Accounts and tokens are kept.
  serve                Run the MCP server over stdio. Server start command: multi-account-netlify-mcp serve
                       The agents start it for you. Run it by hand only to test: it then waits for an MCP
                       client on stdin.

With no command, a terminal shows this help. Anything else that starts the program (an agent) gets the server.
`;

// With no command, a terminal gets the help. Anything else (an agent's pipe) gets the server, as before.
export const commandWhenNone = (stdinIsTerminal: boolean): 'help' | 'serve' => (stdinIsTerminal ? 'help' : 'serve');
