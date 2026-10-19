# Command reference

Every command of `multi-account-netlify-mcp`. Run `multi-account-netlify-mcp help` for a short version of this page.

```text
multi-account-netlify-mcp <command>
```

| Command | What it does |
|---|---|
| [`add <name> [--pat]`](#add) | add a Netlify account (browser login, or a personal access token) |
| [`list`](#list) | show the accounts |
| [`default <name>`](#default) | choose the account used when a call names none |
| [`remove <name>`](#remove) | remove an account and its stored token |
| [`install [agent ...]`](#install) | install into agents |
| [`update [agent ...]`](#update) | refresh existing installs |
| [`uninstall [agent ...]`](#uninstall) | remove installs |
| [`doctor`](#doctor) | check everything |
| [`serve`](#serve) | run the MCP server over stdio (agents start it; with no command, a terminal shows the help) |
| `help`, `--help`, `-h` | print the short usage |

## add

```sh
multi-account-netlify-mcp add <name> [--pat]
```

Adds a Netlify account.

- Without `--pat`, runs `netlify login` in a throwaway profile. A browser window opens. Sign in with the account you want to call `<name>`.
- With `--pat`, asks for a Netlify personal access token. The input is hidden while you type.
- The token is checked against Netlify (`GET /api/v1/user`) before anything is stored. The check also tells us whose account it is.
- The token goes into the credential store. The account record (name, email, user id, how it was added, date) goes into `accounts.json`.
- The first account added becomes the default.

In a chat, an agent can add an account with the `account_add` tool. It runs the same browser login. See [MCP.md](MCP.md#adding-accounts-from-the-chat).

Name rules: 1 to 32 lowercase letters, digits or hyphens, starting with a letter or digit. `all` is reserved. An account name that is already used is refused, and so is a Netlify login that is already added under another name.

Output: `Added "work" (you@example.com). It is the default account.`

See [ACCOUNTS.md](ACCOUNTS.md) for what happens to the login and the token.

## list

```sh
multi-account-netlify-mcp list
```

Prints one line per account: `*` marks the default, then the name, the email and how it was added (`login` or `pat`). Tokens are never printed. If no account is the default, it says so.

## default

```sh
multi-account-netlify-mcp default <name>
```

Chooses the account that a tool call uses when it does not name one. Only an account that exists can be the default.

## remove

```sh
multi-account-netlify-mcp remove <name>
```

Removes the account from `accounts.json` and deletes its token from the credential store. If it was the default, there is no default afterwards. It does not change any agent's install. A running server keeps the token it started with until it restarts.

## install

```sh
multi-account-netlify-mcp install [agent ...] [--scope global|project|local] [--project-dir DIR] [--source SRC] [--dry-run] [--yes]
```

Installs the server into agents.

- **Agents**: `claude`, `codex`, `opencode`, `antigravity`, or `all`. Several names may be given. With no name, or with `all`, it uses every agent that is set up on this machine.
- **`--scope`**: `global` (the default), `project`, or `local`. `local` is only for Claude Code. An agent that does not support the scope is skipped with a reason when you did not name it, and is an error when you did.
- **`--project-dir DIR`**: the folder for `project` and `local`. Defaults to the current folder.
- **`--source SRC`**: where Claude Code takes the marketplace from: a folder or a GitHub repo. Global installs default to the installed package folder. Project and local installs default to GitHub, which is safe to commit.
- **`--dry-run`**: prints the plan and the command, and changes nothing.
- **`--yes`**: skips the final confirmation in a terminal.

In a terminal, any answer left out is asked for: the agents (numbers or names, or Enter for every agent set up here), then the scope, then the folder for a project or local scope. Each invalid answer is asked again. The exact command is shown before anything is written, then the question `Run it? [y/N]`. In a script, nothing is asked: the flags are used as given.

Output, in order:

```text
Plan: codex: global | antigravity: global
Command: multi-account-netlify-mcp install codex antigravity --scope global
ok       codex        global: added with codex mcp add (multi-account-netlify)
ok       codex        global skill: C:\Users\you\.codex\skills\netlify-accounts
ok       antigravity  mcp add: added with agy mcp add (multi-account-netlify)
ok       antigravity  skill: C:\Users\you\.gemini\config\skills\netlify-accounts
```

Each result line is `status agent action: detail`. The statuses are `ok` (done), `skipped` (nothing to do, or not possible here, with the reason), `warning` (done, but something needs attention) and `error` (failed). The command exits with 1 if any line is an error.

Unknown options are an error, so a typo never runs a different install. `--scope` without a value is an error.

## update

```sh
multi-account-netlify-mcp update [agent ...] [--scope global|project|local|all] [--project-dir DIR]
```

Refreshes installs that already exist. Defaults: the agents set up on this machine, and every scope (`all`).

- Claude Code: refreshes the marketplace once, then updates the plugin in each selected scope.
- Codex, opencode, Antigravity: rewrites the server entry and the skill, but only where this tool recorded an install. An agent or scope with no install is skipped.

Restart the agents afterwards. To update the code too, run `npm install -g multi-account-netlify-mcp@latest` first.

## uninstall

```sh
multi-account-netlify-mcp uninstall [agent ...] [--scope global|project|local|all] [--project-dir DIR]
```

Removes the server from agents. Defaults: every agent, and every scope (`all`). `all` covers the global install and the install in `--project-dir`, so an install in another folder is left alone.

- Only what this tool recorded is removed. Other servers, instructions and settings in the agent's files are kept.
- Accounts and tokens are kept. Use `remove <name>` for those.
- A config file or folder that this tool created, and that is now empty, is removed.

## doctor

```sh
multi-account-netlify-mcp doctor
```

Prints:

- the data folder and the Node version;
- each agent and scope as a status line (`ok`, `skipped`, `warning` or `error`). Claude Code's line shows whether the plugin is enabled, and for a project or local install whether it is enabled in this folder;
- the official server and the Netlify CLI paths, or `NOT FOUND`;
- each account, with `token accepted` (and whose account it is), `NO TOKEN` (add it again), or the error Netlify returned.

`doctor` does not change anything, and it exits with 0 unless something unexpected happens.

## serve

```sh
multi-account-netlify-mcp serve
```

Runs the MCP server over stdio. The server start command is `multi-account-netlify-mcp serve`. Agents run it for you, so you should not need it by hand. With no command, a terminal shows the help instead. Anything that starts the program without a terminal, such as an agent, gets the server. Nothing but the MCP protocol is written to standard output in this mode. Errors go to standard error.

## Output and exit codes

| Command | Exit code 0 | Exit code 1 |
|---|---|---|
| `install`, `update`, `uninstall` | every step is `ok`, `skipped` or `warning` | any step is `error`, or the command could not run |
| `add`, `remove`, `default`, `list` | done | an error (for example an invalid name, or an unknown account) |
| `doctor` | always, unless something unexpected happens | not used |

Errors are printed as `Error: <message>` on standard error.
