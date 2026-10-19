# multi-account-netlify-mcp

Use several Netlify accounts from Claude Code at the same time. This module runs the official [`@netlify/mcp`](https://www.npmjs.com/package/@netlify/mcp) server once per account and adds an `account` argument to each tool. The official package is never edited, so `npm update` brings in its changes.

Send a call to one account, to a list of accounts, or to all of them. Each account is added with its own Netlify login, and its token is stored in the operating system's credential store.

Status: version 0.1.0. Tested on Windows only.

## Install

Requirements: Node.js 22 or newer, and Claude Code.

```sh
npm install -g multi-account-netlify-mcp
multi-account-netlify-mcp install
multi-account-netlify-mcp add work
multi-account-netlify-mcp add personal
multi-account-netlify-mcp default work
```

`add work` opens a browser for the Netlify login. Sign in with the account you want to call `work`. Repeat for each account. Then restart Claude Code and run `multi-account-netlify-mcp doctor` to check.

No browser on this machine? `multi-account-netlify-mcp add work --pat` asks for a Netlify personal access token instead. The token is hidden while you type it.

### Scopes

`install` takes the same three scopes as Claude Code's plugin manager. `global` is the default.

| Scope | Where it applies | Recorded in | Shared through git |
|---|---|---|---|
| `global` (default) | every folder, for your user account | Claude Code's user settings | no |
| `project` | the folder you pick | `.claude/settings.json` | yes, commit it |
| `local` | the folder you pick, only for you | `.claude/settings.local.json` | no |

```sh
multi-account-netlify-mcp install                                  # global
multi-account-netlify-mcp install --scope project                  # the current folder, shared through git
multi-account-netlify-mcp install --scope local                    # the current folder, not shared
multi-account-netlify-mcp install --scope project --project-dir D:\work\app
multi-account-netlify-mcp update                                   # every scope where it is installed
multi-account-netlify-mcp uninstall --scope local                  # one scope; the default is all
```

`uninstall` and `update` default to `all`: the global install, plus any project or local install in the current folder. A project or local install of another folder is left alone.

A project install is safe to commit, because it holds the marketplace (from GitHub) and the plugin reference, not your machine's paths. The `cli_path` setting holds this machine's path and is not committed. Each teammate runs `install --scope project` once on their own machine.

### Install through the Claude Code plugin manager

After the npm install, you can also use Claude Code's own plugin commands. The plugin needs the path to the installed CLI, so get it first:

```sh
npm root -g
```

Then, in Claude Code:

```text
/plugin marketplace add FiredMosquito831/multi-account-netlify-mcp
/plugin install multi-account-netlify@multi-account-netlify-mcp
```

When asked for `cli_path`, give the folder printed by `npm root -g`, followed by `multi-account-netlify-mcp/dist/cli.js`. `multi-account-netlify-mcp install` fills this in for you, so the command above is only needed when you install from the plugin manager.

## Use

Ask Claude as usual. Each Netlify tool takes an optional `account` argument:

| Value | What happens |
|---|---|
| left out | the default account (set with `default <name>`). With no default and several accounts, Claude is asked to choose. |
| `work` | the call runs on that account only, and the result is the official result. |
| `work,personal` | reads run on each listed account. Writes are refused: name one account. |
| `all` | reads run on every account. Writes are refused: name one account. |

Which operations can span accounts depends on the operation:

- **Reads with no id** (your user, your teams, the project list, extensions): every account answers, and every answer is shown.
- **Reads that need an id** (a project, deploy, team, or site): every account is asked, and only the one that owns the id answers. The others are listed under `notFoundIn`.
- **Reads of sensitive data** (env var values, form submissions, request logs): these can run on all accounts.
- **Writes** (deploy, create or rename projects, forms, extensions, changing env vars, deleting submissions): one account only. A list or `all` is refused.

One account failing does not stop the others. In a multi-account result, each account has `ok` and either `result` or `error`.

Plugin commands:

| Command | What it does |
|---|---|
| `/multi-account-netlify:accounts` | list the accounts (tokens are never shown) |
| `/multi-account-netlify:add-account <name> [--pat]` | add an account. The login runs in your terminal, so type the command it gives you. |
| `/multi-account-netlify:set-default <name>` | choose the default account |
| `/multi-account-netlify:remove-account <name>` | remove an account and its stored token, after you confirm |
| `/multi-account-netlify:doctor` | check the data folder, the official server, the plugin and each token |

The same commands work in a terminal, for example `multi-account-netlify-mcp list`.

## Update

```sh
npm install -g multi-account-netlify-mcp@latest
multi-account-netlify-mcp update
```

Then restart Claude Code. `update` refreshes the plugin. The npm command also updates the official `@netlify/mcp` package, because it is a dependency.

## Uninstall

```sh
multi-account-netlify-mcp remove work       # once per account; deletes its stored token
multi-account-netlify-mcp uninstall         # removes the plugin from every scope here (add --scope to pick one)
npm uninstall -g multi-account-netlify-mcp
```

To remove the marketplace as well, run `claude plugin marketplace remove multi-account-netlify-mcp`.

## Security

- Tokens are stored in the operating system's credential store. On Windows that is Credential Manager, with one entry per account. `accounts.json` holds names, emails and dates, never tokens.
- Each `add` runs `netlify login` in a throwaway profile folder. Your own Netlify CLI login is never read or changed.
- Each official server runs with an empty config folder and only its own account's token. It cannot read your main Netlify CLI login.
- `all` and comma lists send a call to several accounts. Write tools then change every account they name, so check before you ask for that.

## Where things live

- Data folder: `%LOCALAPPDATA%\multi-account-netlify-mcp` on Windows, `~/.local/share/multi-account-netlify-mcp` elsewhere. It holds `accounts.json`.
- Tokens: the credential store, service name `multi-account-netlify-mcp`, one entry per account name.

## Development

```sh
npm install
npm test        # builds, then runs the tests in dist/test
npm run typecheck
```

The tests include checks against the real `@netlify/mcp` package, so they fail if an official update breaks what this module depends on.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
