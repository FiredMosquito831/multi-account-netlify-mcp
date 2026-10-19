# multi-account-netlify-mcp

Use several Netlify accounts from your AI coding agent at the same time.

This module runs the official [`@netlify/mcp`](https://www.npmjs.com/package/@netlify/mcp) server once per account and adds an `account` argument to each of its tools. Send a call to one account, to a list of accounts, or to all of them. Each account is added with its own Netlify login, from a terminal or from the chat, and its token is stored in the operating system's credential store. The official package is never edited, so `npm update` brings in its changes.

It installs into four agents: **Claude Code**, **Codex**, **opencode** and **Google Antigravity** (`agy`).

Status: version 0.1.3. Tested on Windows only.

## Quick start

```sh
npm install -g multi-account-netlify-mcp
multi-account-netlify-mcp install
multi-account-netlify-mcp add work
multi-account-netlify-mcp add personal
multi-account-netlify-mcp default work
multi-account-netlify-mcp doctor
```

`install` in a terminal asks which agents and which scope you want, then shows the exact command before it runs. `add work` opens a browser for the Netlify login: sign in with the account you want to call `work`. In a chat, ask the agent to add an account instead: it uses the `account_add` tool, which opens the same sign-in. Restart the agents you installed into, and ask one of them about your Netlify sites.

No browser on this machine? `add work --pat` asks for a Netlify personal access token instead. The input is hidden.

## What you get

- **One tool set, many accounts.** Each official Netlify tool takes an `account` argument: one name, a comma-separated list, or `all`. Reads can run on several accounts at once. A change always runs on one account.
- **Safe by design.** Changes are never sent to several accounts. Tokens never appear in config files, in output, or in the chat.
- **Installs everywhere you work.** Claude Code (plugin), Codex, opencode and Antigravity each get the server and the account guide, at the scope you choose.
- **Clean uninstalls.** Each install records what it wrote, so uninstall removes only that.

## Documentation

| Document | What it covers |
|---|---|
| [docs/INSTALL.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/INSTALL.md) | Requirements, install paths, updating, uninstalling |
| [docs/USAGE.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/USAGE.md) | Every command and option, output format, exit codes |
| [docs/AGENTS.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/AGENTS.md) | Each agent: scopes, what is written where, skills, limits |
| [docs/MCP.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/MCP.md) | The tools, the `account` argument, routing rules, result shapes |
| [docs/ACCOUNTS.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/ACCOUNTS.md) | Logins, personal access tokens, storage, defaults, removal |
| [docs/SAFETY.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/SAFETY.md) | What is refused, what needs confirmation, secrets and personal data |
| [docs/CONFIGURATION.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/CONFIGURATION.md) | Environment variables, data folder, state files, config files |
| [docs/TROUBLESHOOTING.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/TROUBLESHOOTING.md) | Common errors and how to fix them |
| [docs/TESTING.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/TESTING.md) | The test suite, live checks, CI |
| [docs/DEVELOPMENT.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/DEVELOPMENT.md) | Code layout, adding an agent or an operation |
| [docs/RELEASING.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/RELEASING.md) | How a release reaches npm |
| [CHANGELOG.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/CHANGELOG.md) | What changed in each version |

## Agents

`install` takes the agents to set up: `claude`, `codex`, `opencode`, `antigravity`, or `all`. With no agent named, it installs into every agent that is set up on this machine.

| Agent | Global | Project | Local | Server registered with | Skill |
|---|---|---|---|---|---|
| Claude Code | yes | yes | yes | the plugin (`claude plugin`) | yes, in the plugin |
| Codex | yes | yes | no | `codex mcp add` (global), `.codex/config.toml` (project) | yes |
| opencode | yes | yes | no | `opencode.json` entry | yes, through `instructions` |
| Antigravity | yes | no | no | `agy mcp add` | yes |

```sh
multi-account-netlify-mcp install                      # every agent set up here, global
multi-account-netlify-mcp install codex opencode       # only these two, global
multi-account-netlify-mcp install --scope project      # every agent set up here, this folder
multi-account-netlify-mcp install claude --scope local # Claude Code, this folder, only for you
multi-account-netlify-mcp install --dry-run            # show the plan, change nothing
multi-account-netlify-mcp update                       # refresh what is already installed
multi-account-netlify-mcp uninstall codex              # remove from Codex, in every scope
```

In a terminal, `install` asks for anything you left out, and shows the exact command before it runs. Scripts and CI pass flags, and nothing is asked. `--yes` skips the final confirmation. See [docs/AGENTS.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/AGENTS.md) for what each agent gets.

## Scopes

- **global** (default): every folder, for your user account.
- **project**: the folder you pick, and it can be shared through git.
- **local**: the folder you pick, only for you (Claude Code only).

For Claude Code, a project install is safe to commit: `.claude/settings.json` then holds the marketplace (from GitHub) and the plugin reference, not your machine's paths. The other agents' project files hold this computer's Node and CLI paths, so do not commit those.

## Use

Ask your agent as usual. Each Netlify tool takes an optional `account` argument:

| Value | What happens |
|---|---|
| left out | the default account (set with `default <name>`). With no default and several accounts, the call fails and lists the names. |
| `work` | the call runs on that account only, and the result is the official result. |
| `work,personal` | reads run on each listed account. Changes are refused: name one account. |
| `all` | reads run on every account. Changes are refused: name one account. |

How each operation can span accounts is in [docs/MCP.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/MCP.md). In short: reads with no id run on every account; reads that need an id (a project, deploy, team or site) reach every account and keep only the account that owns the id; reads of sensitive data may span accounts; changes stay on one account.

Plugin commands in Claude Code:

| Command | What it does |
|---|---|
| `/multi-account-netlify:accounts` | list the accounts (tokens are never shown) |
| `/multi-account-netlify:add-account <name> [--pat]` | add an account. A browser login is done by the agent with the `account_add` tool. With `--pat`, type the command it gives you in your terminal, so the token stays out of the chat. |
| `/multi-account-netlify:set-default <name>` | choose the default account |
| `/multi-account-netlify:remove-account <name>` | remove an account and its stored token, after you confirm |
| `/multi-account-netlify:doctor` | check the data folder, the official server, the agents and each token |

The same account commands work in a terminal, for example `multi-account-netlify-mcp list`. The agent also has two account tools: `account_add` (a browser login) and `account_list`.

## Update

```sh
npm install -g multi-account-netlify-mcp@latest
multi-account-netlify-mcp update
```

Then restart the agents. `update` refreshes only the installs that already exist. The npm command also updates the official `@netlify/mcp` package, because it is a dependency.

## Uninstall

```sh
multi-account-netlify-mcp remove work       # once per account; deletes its stored token
multi-account-netlify-mcp uninstall         # removes this server from every agent and scope here
npm uninstall -g multi-account-netlify-mcp
```

See [docs/INSTALL.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/INSTALL.md#uninstalling) for the full list, including the Claude Code marketplace.

## Security

- Tokens are stored in the operating system's credential store. On Windows that is Credential Manager, with one entry per account. `accounts.json` holds names, emails and dates, never tokens.
- Each `add` runs `netlify login` in a throwaway profile folder. Your own Netlify CLI login is never read or changed.
- Each official server runs with an empty config folder and only its own account's token.
- Agent config files are backed up (`.bak`) before a change, and an invalid file is never overwritten.
- Changes are never sent to several accounts. Reads are.

Report security issues privately through GitHub's security advisories for this repository, not in a public issue. See [SECURITY.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/SECURITY.md).

## Limits

- Tested on Windows only. macOS and Linux are untested.
- The guided install questions are tested with scripted answers, not yet in a real terminal.
- Codex and Antigravity skills are loaded from the folders listed in [docs/AGENTS.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/AGENTS.md). Their discovery is verified by location and format, not by a live model run.
- opencode installs only into `opencode.json`. A `opencode.jsonc` file is not touched.
- Claude Code keeps the marketplace declaration after an uninstall, because other folders may use it.
- The official `netlify` MCP server, if you also have it installed, gives you duplicate tools. Remove that entry when you use this one.

## Development

```sh
npm install
npm test          # builds, then runs the tests in dist/test
npm run typecheck
```

See [docs/DEVELOPMENT.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/DEVELOPMENT.md) and [docs/TESTING.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/docs/TESTING.md).

## License

Apache License 2.0. See [LICENSE](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/LICENSE) and [NOTICE](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/NOTICE).
