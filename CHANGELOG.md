# Changelog

All notable changes to this project. Dates are when the change landed.

## 0.1.3

Four agents, skills, and clearer tool definitions.

- **Four agents.** `install`, `update`, `uninstall` and `doctor` work for Claude Code, Codex, opencode and Antigravity (`agy`). Name the agents, or leave them out to use every agent set up on the machine.
- **Codex.** Global installs use `codex mcp add`. Project installs write a table into `.codex/config.toml`. Both get the account skill.
- **opencode.** Entries in `opencode.json`, global or project, with a `.bak` copy before every change. Invalid files are refused. Both get the account skill, through `instructions`.
- **Antigravity.** Global only, through `agy mcp add`, with the account skill in `~/.gemini/config/skills`.
- **Per-agent records.** Each install is recorded, so uninstall removes only what this tool wrote.
- **Guided install.** In a terminal, `install` asks for what the flags left out, and shows the exact command before it runs. `--dry-run` shows the plan and changes nothing.
- **Tool definitions.** Each tool's description lists how each of its operations can use several accounts, and the `account` argument says that changes need one name. Agents see these rules without a skill.
- **Skill.** The account guide is now agent-neutral, and it is installed for every agent that reads skills.
- **Docs.** README rewritten, and a `docs/` set: installation, command reference, agents, MCP, accounts, safety, configuration, troubleshooting, testing, development and releasing.

## 0.1.2

- Install scopes: `--scope global|project|local` for `install`, `update` and `uninstall`, with `--project-dir` for the folder. Claude Code's scopes, named the same way as google-services-mcps.
- Tool calls get up to 15 minutes instead of the SDK's 60 seconds, so a large `deploy-site` upload is not cut off.

## 0.1.1

- Calls are routed by operation. Changes run on one account, and a list or `all` is refused for them. Reads that need an id reach every account and keep the one that owns the id. Operations the table does not know count as changes.
- A release workflow publishes to npm when a GitHub release is published, with provenance. It also publishes on a push to `main` when the version is new, and it runs CI on Windows and Ubuntu.

## 0.1.0

- First public release.
- One official `@netlify/mcp` server per account, with the `account` argument added to each tool.
- Accounts are added with a separate `netlify login`, or with a personal access token. Tokens are kept in the credential store.
- Claude Code plugin with five account commands and an account skill.
- Install into Claude Code in the user scope, and in a project.
- Apache-2.0 license.
