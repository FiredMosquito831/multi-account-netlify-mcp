# Installing

This page covers the requirements, every way to install, how to update, and how to remove everything. For the commands and their options, see [USAGE.md](USAGE.md). For what each agent gets, see [AGENTS.md](AGENTS.md).

## Requirements

- **Node.js 22 or newer** (`node --version`). The npm package declares `engines.node >= 22`.
- **npm**, to install the package.
- **At least one agent**:
  - Claude Code, with the `claude` command on PATH. Used for the plugin.
  - Codex, with the `codex` command on PATH. Used for the global server entry and the project config.
  - opencode. Its config is a file, so the `opencode` command is only used to check the result.
  - Google Antigravity, with the `agy` command on PATH.
- **Windows** is the tested platform. Tokens are kept in Windows Credential Manager. macOS and Linux are untested.

The package installs the official `@netlify/mcp` server, the MCP SDK, the credential-store binding, and `netlify-cli`. The Netlify CLI is used only to run `netlify login` when you add an account.

## Install from npm (recommended)

```sh
npm install -g multi-account-netlify-mcp
multi-account-netlify-mcp install
```

`install` with no arguments installs into every agent that is set up on the machine, at global scope. In a terminal it asks which agents and which scope you want first, and shows the exact command before it runs. See [USAGE.md](USAGE.md#install) for the options.

Then add your accounts:

```sh
multi-account-netlify-mcp add work
multi-account-netlify-mcp add personal
multi-account-netlify-mcp default work
multi-account-netlify-mcp doctor
```

Restart each agent you installed into. The server is read when an agent starts, so an agent that was already open will not see the new tools until it restarts.

## Install through Claude Code's plugin manager

If you prefer Claude Code's own plugin commands, install the npm package first, because the plugin runs the installed CLI. Then find the path of the installed CLI:

```sh
npm root -g
```

In Claude Code:

```text
/plugin marketplace add FiredMosquito831/multi-account-netlify-mcp
/plugin install multi-account-netlify@multi-account-netlify-mcp
```

When Claude Code asks for `cli_path`, give the path `npm root -g` printed, followed by `multi-account-netlify-mcp/dist/cli.js`. Running `multi-account-netlify-mcp install --scope <scope>` does the same thing and fills `cli_path` in for you, so most people do not need this route.

## Install from a clone (development)

```sh
git clone https://github.com/FiredMosquito831/multi-account-netlify-mcp.git
cd multi-account-netlify-mcp
npm install
npm run build
node dist/cli.js install --source "$PWD"
```

A global install takes the Claude Code marketplace from the installed package folder, which is your clone here. A project or local install takes it from GitHub by default, so pass the folder explicitly to use your clone: `node dist/cli.js install --scope project --source "$PWD"`. See [DEVELOPMENT.md](DEVELOPMENT.md).

## Updating

```sh
npm install -g multi-account-netlify-mcp@latest
multi-account-netlify-mcp update
```

- The npm command updates this package, and the official `@netlify/mcp` it depends on.
- `update` refreshes the installs that already exist: the Claude Code plugin, and the server entries for Codex, opencode and Antigravity, with their skills. It never adds an install to an agent or scope that has none.
- Restart each agent afterwards.
- Your accounts and their tokens are not changed by an update.

## Uninstalling

Remove the agent installs first, then the accounts, then the package:

```sh
multi-account-netlify-mcp uninstall         # every agent and scope here
multi-account-netlify-mcp uninstall codex   # or only one agent
multi-account-netlify-mcp remove work       # once per account: deletes its stored token
npm uninstall -g multi-account-netlify-mcp
```

What each step does:

- **`uninstall`** removes the server entry and the skill from each agent, but only what this tool recorded for that agent and scope. Your other servers and settings are kept. Accounts and tokens are kept. A config file or folder that is left empty after this tool's entries are removed is removed too, so an install leaves nothing behind.
- **`remove <name>`** removes the account from `accounts.json` and deletes its token from the credential store. It does not touch any agent.
- **`npm uninstall -g`** removes the package. The data folder (`%LOCALAPPDATA%\multi-account-netlify-mcp`) stays, so reinstalling keeps your accounts. Delete that folder by hand to remove it completely.

For Claude Code, `uninstall` keeps the marketplace declaration, because other folders may use it. To remove it too:

```sh
claude plugin marketplace remove multi-account-netlify-mcp
```

## Verifying an install

```sh
multi-account-netlify-mcp doctor
```

`doctor` prints the data folder, the official server path, each agent and scope (`ok`, `skipped`, `warning` or `error`), and whether each account's token is accepted by Netlify. See [USAGE.md](USAGE.md#doctor).
