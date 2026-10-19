# multi-account-netlify-mcp

Use several Netlify accounts from Claude Code at the same time. This module runs the official [`@netlify/mcp`](https://www.npmjs.com/package/@netlify/mcp) server once per account and adds an `account` argument to each tool. The official package is never edited, so `npm update` brings in its changes.

Send a call to one account, to a list of accounts, or to all of them. Each account is added with its own Netlify login, and its token is stored in the operating system's credential store.

Status: version 0.1.0, not yet published to npm. Tested on Windows only.

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
| `work,personal` | the call runs on each listed account. The result has one entry per account. |
| `all` | the call runs on every account. |

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
multi-account-netlify-mcp uninstall         # removes the Claude Code plugin
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

To be decided before publishing.
