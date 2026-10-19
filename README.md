# multi-account-netlify-mcp

Use several Netlify accounts from your AI coding agent at the same time. This module runs the official [`@netlify/mcp`](https://www.npmjs.com/package/@netlify/mcp) server once per account and adds an `account` argument to each tool. The official package is never edited, so `npm update` brings in its changes.

Send a call to one account, to a list of accounts, or to all of them. Each account is added with its own Netlify login, and its token is stored in the operating system's credential store.

It installs into four agents: Claude Code, Codex, opencode and Google Antigravity (`agy`).

Status: version 0.1.2. Tested on Windows only.

## Install

Requirements: Node.js 22 or newer, and at least one of the agents above.

```sh
npm install -g multi-account-netlify-mcp
multi-account-netlify-mcp install
multi-account-netlify-mcp add work
multi-account-netlify-mcp add personal
multi-account-netlify-mcp default work
```

`install` in a terminal asks which agents and which scope you want, then shows the exact command before it runs. Scripts and CI pass flags instead, and nothing is asked (see [Agents](#agents)).

`add work` opens a browser for the Netlify login. Sign in with the account you want to call `work`. Repeat for each account. Then restart the agents you installed into, and run `multi-account-netlify-mcp doctor` to check.

No browser on this machine? `multi-account-netlify-mcp add work --pat` asks for a Netlify personal access token instead. The token is hidden while you type it.

## Agents

`install` takes the agents to set up: `claude`, `codex`, `opencode`, `antigravity`, or `all`. With no agent named, it installs into every agent that is set up on this machine.

| Agent | Global | Project | Local | How it is registered |
|---|---|---|---|---|
| Claude Code | yes | yes | yes | the plugin, with `claude plugin` |
| Codex | yes | yes | no | `codex mcp add` for global. For a project, a table in `.codex/config.toml`, which Codex reads only when the folder is trusted. |
| opencode | yes | yes | no | an entry in `opencode.json`, with a `.bak` copy made before every change |
| Antigravity | yes | no | no | `agy mcp add` |

```sh
multi-account-netlify-mcp install                     # every agent set up here, global
multi-account-netlify-mcp install codex opencode       # only these two, global
multi-account-netlify-mcp install --scope project      # every agent set up here, this folder
multi-account-netlify-mcp install --dry-run            # show the plan, change nothing
multi-account-netlify-mcp update                       # refresh what is already installed
multi-account-netlify-mcp uninstall codex              # remove from Codex, in every scope
```

In a terminal, `install` asks for anything you left out, and shows the exact command before it runs. Scripts and CI pass flags, and nothing is asked. `--yes` skips the final confirmation.

Each agent gets only this server's entry. Other servers and settings in those files are kept. An install never touches a file that is not valid JSON or TOML: it stops and says so. Each install is recorded, so uninstall removes only what this tool wrote.

## Scopes

- **global** (default): every folder, for your user account.
- **project**: the folder you pick, shared through git.
- **local**: the folder you pick, only for you.

Not every agent supports every scope. An install into all agents skips the ones that lack the scope and says why. Naming an agent with a scope it lacks is an error.

| Scope | Claude Code records it in | Other agents record it in | Shared through git |
|---|---|---|---|
| global | Claude Code's user settings | the agent's global config | no |
| project | `.claude/settings.json` | `.codex/config.toml`, `opencode.json` in the folder | yes, for the plugin reference. See below. |
| local | `.claude/settings.local.json` | not supported | no |

```sh
multi-account-netlify-mcp install --scope project --project-dir D:\work\app
multi-account-netlify-mcp update --scope local
multi-account-netlify-mcp uninstall --scope global
```

`update` and `uninstall` default to every scope where the server is installed, and every agent. For Claude Code, that is the global install plus any project or local install in the current folder. A project or local install of another folder is left alone.

A project install is safe to commit for Claude Code, because `.claude/settings.json` then holds the marketplace (from GitHub) and the plugin reference, not your machine's paths. For the other agents, the project file holds this computer's Node and CLI paths, so do not commit it. Each teammate runs `install --scope project` once on their own machine.

## Install through the Claude Code plugin manager

After the npm install, you can also use Claude Code's own plugin commands. The plugin needs the path to the installed CLI, so get it first:

```sh
npm root -g
```

Then, in Claude Code:

```text
/plugin marketplace add FiredMosquito831/multi-account-netlify-mcp
/plugin install multi-account-netlify@multi-account-netlify-mcp
```

When asked for `cli_path`, give the folder printed by `npm root -g`, followed by `multi-account-netlify-mcp/dist/cli.js`. `multi-account-netlify-mcp install` fills this in for you, so the commands above are only needed when you install from the plugin manager.

## Use

Ask your agent as usual. Each Netlify tool takes an optional `account` argument:

| Value | What happens |
|---|---|
| left out | the default account (set with `default <name>`). With no default and several accounts, the agent is asked to choose. |
| `work` | the call runs on that account only, and the result is the official result. |
| `work,personal` | reads run on each listed account. Writes are refused: name one account. |
| `all` | reads run on every account. Writes are refused: name one account. |

Which operations can span accounts depends on the operation:

- **Reads with no id** (your user, your teams, the project list, extensions): every account answers, and every answer is shown.
- **Reads that need an id** (a project, deploy, team, or site): every account is asked, and only the one that owns the id answers. The others are listed under `notFoundIn`.
- **Reads of sensitive data** (env var values, form submissions, request logs): these can run on all accounts.
- **Writes** (deploy, create or rename projects, forms, extensions, changing env vars, deleting submissions): one account only. A list or `all` is refused.

One account failing does not stop the others. In a multi-account result, each account has `ok` and either `result` or `error`.

Plugin commands in Claude Code:

| Command | What it does |
|---|---|
| `/multi-account-netlify:accounts` | list the accounts (tokens are never shown) |
| `/multi-account-netlify:add-account <name> [--pat]` | add an account. The login runs in your terminal, so type the command it gives you. |
| `/multi-account-netlify:set-default <name>` | choose the default account |
| `/multi-account-netlify:remove-account <name>` | remove an account and its stored token, after you confirm |
| `/multi-account-netlify:doctor` | check the data folder, the official server, the agents and each token |

The same account commands work in a terminal, for example `multi-account-netlify-mcp list`.

## Update

```sh
npm install -g multi-account-netlify-mcp@latest
multi-account-netlify-mcp update
```

Then restart the agents. `update` refreshes only the installs that already exist. The npm command also updates the official `@netlify/mcp` package, because it is a dependency.

## Uninstall

```sh
multi-account-netlify-mcp remove work       # once per account; deletes its stored token
multi-account-netlify-mcp uninstall         # removes this server from every agent and scope here (add an agent name or --scope to pick)
npm uninstall -g multi-account-netlify-mcp
```

To remove the Claude Code marketplace as well, run `claude plugin marketplace remove multi-account-netlify-mcp`.

## Security

- Tokens are stored in the operating system's credential store. On Windows that is Credential Manager, with one entry per account. `accounts.json` holds names, emails and dates, never tokens.
- Each `add` runs `netlify login` in a throwaway profile folder. Your own Netlify CLI login is never read or changed.
- Each official server runs with an empty config folder and only its own account's token. It cannot read your main Netlify CLI login.
- Agent config files are backed up (`.bak`) before a change, and an invalid file is never overwritten.
- `all` and comma lists send a call to several accounts. Reads are safe to fan out. Writes are never fanned out.

## Where things live

- **Data folder:** `%LOCALAPPDATA%\multi-account-netlify-mcp` on Windows, `~/.local/share/multi-account-netlify-mcp` elsewhere. It holds `accounts.json`, and `state/<agent>.json` with what each install wrote.
- **Tokens:** the credential store, service name `multi-account-netlify-mcp`, one entry per account name.
- **Codex:** `codex mcp add` writes to Codex's own config. A project install writes `.codex/config.toml` in the folder.
- **opencode:** `~/.config/opencode/opencode.json` for global (with the skill in `~/.config/opencode/multi-account-netlify/`). `opencode.json` in the folder for project.
- **Antigravity:** `agy mcp add` writes to its own config (`~/.gemini/config/mcp_config.json`).
- **Claude Code:** the plugin is managed by `claude plugin`.

## Limits

- Tested on Windows only. macOS and Linux are untested.
- The guided install questions have been tested with scripted answers, but not in a real terminal yet.
- Codex and Antigravity get the server, not the account skill. Codex needs a Codex plugin for the skill, which this project does not have yet. Antigravity's skills need a plugin setting that `agy` cannot set yet. opencode gets the skill through its instructions setting.
- opencode installs only into `opencode.json`. If you keep an `opencode.jsonc` file, this tool does not touch it.
- Claude Code keeps the marketplace declaration after an uninstall, because other folders may use it.

## Development

```sh
npm install
npm test        # builds, then runs the tests in dist/test
npm run typecheck
```

The tests include checks against the real `@netlify/mcp` package, so they fail if an official update breaks what this module depends on. Another check compares the policy table with the official operations, so a new official operation cannot reach a multi-account call unclassified.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
