# Configuration

Everything this tool reads or writes, where it lives, and the environment variables that change it.

## Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `MULTI_ACCOUNT_NETLIFY_HOME` | the CLI and the server | The data folder. Default: `%LOCALAPPDATA%\multi-account-netlify-mcp` on Windows, `$XDG_DATA_HOME/multi-account-netlify-mcp` or `~/.local/share/multi-account-netlify-mcp` elsewhere. Use a throwaway folder to test. |
| `CODEX_HOME` | the CLI (Codex installs) | Codex's home folder. Its config and skills live here. Default: `~/.codex`. The folder must exist before Codex is used. |
| `NETLIFY_PERSONAL_ACCESS_TOKEN` | the official server | Set by this tool, for each account's server process only. Do not set it yourself for everything. |
| `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, `HOME`, `USERPROFILE` | the login and each server process | Pointed at throwaway folders, so the Netlify CLI and the official server never read your own Netlify login. See [ACCOUNTS.md](ACCOUNTS.md#isolation-during-login). |
| `NETLIFY_AUTH_TOKEN` | nothing here | Removed from the environment of the login, so it cannot skip the login. |

## The data folder

```text
<data folder>/
  accounts.json            names, emails, user ids, how each account was added, the default
  state/
    codex.json             what this tool wrote for Codex, keyed by scope
    opencode.json          what this tool wrote for opencode, keyed by scope
    antigravity.json       what this tool wrote for Antigravity, keyed by scope
  children/<account>/      an empty config folder for each account's server process
  login-profiles/<name>/   a throwaway folder during `add`, deleted when the login ends
```

- `accounts.json` never holds a token. It is written through a temporary file and then renamed, so an interrupted write leaves the old file in place.
- `children/` folders are empty on purpose. They hide your own Netlify login from the official server.
- `login-profiles/` is removed when `add` finishes, whether it succeeded or failed. If one is left behind after a crash, it is safe to delete.

## Tokens

Tokens are not in the data folder. They are in the operating system's credential store:

- **Windows:** Credential Manager, under the service name `multi-account-netlify-mcp`, with one entry per account name.
- **macOS and Linux:** the platform's secret store, through the same binding. These are untested.

## State files

Each `state/<agent>.json` records what an install wrote, so uninstall can remove exactly that. The file is a JSON object keyed by scope:

```json
{
  "global": [
    { "kind": "mcp-entry", "path": "codex mcp", "name": "multi-account-netlify" },
    { "kind": "directory", "path": "C:\\Users\\you\\.codex\\skills\\netlify-accounts" }
  ],
  "project:D:\\work\\app": [
    { "kind": "toml-table", "path": "D:\\work\\app\\.codex\\config.toml", "name": "mcp_servers.multi-account-netlify" }
  ]
}
```

- Scope keys are `global`, `project:<folder>` and `local:<folder>`. Folder paths are compared case-insensitively on Windows.
- `kind` is one of `mcp-entry`, `json-instruction`, `toml-table`, or `directory`.
- Do not edit these files by hand. Remove an install with `uninstall`.
- Claude Code has no state file here, because `claude plugin list` is its record.

## Agent configuration files

| Agent | Scope | File or command | What is written |
|---|---|---|---|
| Claude Code | global | Claude Code's user settings, through `claude plugin` | the plugin (it has no settings) |
| Claude Code | project | `<folder>/.claude/settings.json` | the marketplace (GitHub) and the plugin reference |
| Claude Code | local | `<folder>/.claude/settings.local.json` | the marketplace (GitHub) and the plugin reference |
| Codex | global | `$CODEX_HOME/config.toml`, through `codex mcp add` | `[mcp_servers.multi-account-netlify]` |
| Codex | global | `$CODEX_HOME/skills/netlify-accounts/SKILL.md` | the account skill |
| Codex | project | `<folder>/.codex/config.toml` | `[mcp_servers.multi-account-netlify]` |
| Codex | project | `<folder>/.agents/skills/netlify-accounts/SKILL.md` | the account skill |
| opencode | global | `~/.config/opencode/opencode.json` | `mcp.multi-account-netlify`, and the skill path in `instructions` |
| opencode | global | `~/.config/opencode/multi-account-netlify/SKILL.md` | the account skill |
| opencode | project | `<folder>/opencode.json` | `mcp.multi-account-netlify` |
| Antigravity | global | `~/.gemini/config/mcp_config.json`, through `agy mcp add` | the server entry |
| Antigravity | global | `~/.gemini/config/skills/netlify-accounts/SKILL.md` | the account skill |

- The Codex, opencode and Antigravity entries run `node <path-to-dist/cli.js> serve`. The `node` path is the one that installed the package. The Claude Code plugin is the exception: it runs `multi-account-netlify-mcp serve` from PATH.
- A `.bak` copy is made before any change to an opencode file, and an invalid JSON file is never changed.
- Codex reads a project's `.codex/config.toml` only in a folder you have trusted.

## The Claude Code plugin's command

The Claude Code plugin's MCP server runs `multi-account-netlify-mcp serve`, the command that `npm install -g multi-account-netlify-mcp` puts on PATH. The plugin has no settings, so no machine path is stored in Claude Code or in a project file. Checked on Windows on 2026-10-19: the bare command connects when its `.cmd` shim is on PATH.

## Package settings

- `engines.node`: `>=22`.
- The package's files are `dist/` (without the tests), `.claude-plugin/`, `plugins/`, `README.md`, `LICENSE` and `NOTICE`. `prepack` builds `dist/` first.
- `bin`: `multi-account-netlify-mcp` runs `dist/cli.js`.
