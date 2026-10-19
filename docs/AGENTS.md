# Agents

`multi-account-netlify-mcp install` puts the same server into four agents. Each agent has its own rules for scopes, its own config format, and its own way of finding skills. This page lists them all. For the commands, see [USAGE.md](USAGE.md).

## At a glance

| Agent | Global | Project | Local | Server | Skill |
|---|---|---|---|---|---|
| Claude Code | yes | yes | yes | plugin, through `claude plugin` | yes, in the plugin |
| Codex | yes | yes | no | `codex mcp add` (global), `.codex/config.toml` (project) | yes |
| opencode | yes | yes | no | an entry in `opencode.json` | yes, through `instructions` |
| Antigravity (`agy`) | yes | no | no | `agy mcp add` | yes |

Every server entry starts the same command: `node <path-to-dist/cli.js> serve`, where `node` is the Node.js that installed the package. Those paths are specific to this computer, so project and global files that hold them should not be committed.

Every install is recorded in the data folder under `state/<agent>.json`, keyed by scope, so `uninstall` removes only what this tool wrote. See [CONFIGURATION.md](CONFIGURATION.md#state-files).

## Claude Code

Installed as a plugin, through `claude plugin`.

- **Plugin:** `multi-account-netlify@multi-account-netlify-mcp`. It contains the MCP server, the account commands (`/multi-account-netlify:accounts`, `:add-account`, `:set-default`, `:remove-account`, `:doctor`), and the account skill.
- **Marketplace:** `multi-account-netlify-mcp`. Global installs take it from the installed package folder. Project and local installs take it from GitHub, so the project file can be committed.
- **Scopes:**
  - `global` (Claude Code's user scope): every folder. Recorded in Claude Code's user settings.
  - `project`: recorded in `.claude/settings.json` in the folder. Commit it to share it with a team. Each teammate runs `install --scope project` once, because `cli_path` is this machine's path.
  - `local`: recorded in `.claude/settings.local.json` in the folder. Not shared. Claude Code keeps this file out of git.
- **Plugin setting:** `cli_path`, the path of the installed `dist/cli.js`. It is a user setting stored by Claude Code, not in the project file.
- **Restart:** Claude Code loads the plugin when it starts.
- **Lists:** `claude plugin list --json` is the record for this agent. `uninstall` and `update` find each install there, and run in that install's folder.
- **Marketplace after uninstall:** kept, because other folders may use it. Remove it with `claude plugin marketplace remove multi-account-netlify-mcp`.
- **Verified:** global, project and local installs, enabling in the folder, and uninstall, on Claude Code 2.1.x.

## Codex

- **Global:** `codex mcp add multi-account-netlify -- <node> <cli> serve`, and `codex mcp remove` to undo it. The entry goes into Codex's config, which is `$CODEX_HOME/config.toml`, or `~/.codex/config.toml` when `CODEX_HOME` is not set.
- **Project:** a table `[mcp_servers.multi-account-netlify]` in `.codex/config.toml` in the folder. Only that table is written or removed. Other tables in the file are kept exactly as they are.
- **Trust:** Codex reads a project's `.codex/config.toml` only when you have marked the folder as trusted. This tool does not mark folders as trusted. Trust the folder in Codex when it asks.
- **Skill, global:** `$CODEX_HOME/skills/netlify-accounts/SKILL.md`.
- **Skill, project:** `.agents/skills/netlify-accounts/SKILL.md` in the folder. On uninstall, the empty `.agents/skills` and `.agents` folders are removed too. A folder with anything else in it is kept.
- **No local scope.** Codex has no per-folder install that is not shared, so `local` is refused.
- **Restart:** Codex loads servers and skills when it starts.
- **Verified:** `codex mcp list` shows the server as `enabled`. The skill files were checked by location and format, and by the paths in the Codex binary. A live model run was not used to confirm that Codex loads the skill.

## opencode

- **Global:** an entry `mcp.multi-account-netlify` in `~/.config/opencode/opencode.json`, plus the skill copied to `~/.config/opencode/multi-account-netlify/SKILL.md` and listed under `instructions`.
- **Project:** an entry `mcp.multi-account-netlify` in `opencode.json` in the folder. The project file's command holds this computer's paths, so do not commit it.
- **How it is written:** the file is edited directly, because opencode has no scoped add command. Only the entry and the instruction are written or removed. Other keys are kept. A `.bak` copy of the file is made before every change.
- **Invalid JSON:** a file that is not valid JSON is not changed. The install stops with an error that names the file. JSONC comments make a file invalid for this purpose.
- **Global and project together:** a project install removes the global entry, so the server is not loaded twice. A global install removes a project entry this tool created.
- **Empty files:** an `opencode.json` that this tool created, and that is left with only its `$schema`, is removed on uninstall.
- **`opencode.jsonc`:** not touched. If you keep your configuration in a `.jsonc` file, add the entry there by hand.
- **Restart:** opencode reads its configuration when it starts.
- **Verified:** `opencode mcp list` shows the server as `connected`, which means opencode started it and completed the handshake.

## Antigravity (`agy`)

- **Global only.** Antigravity has no project scope, so `--scope project` is refused when named, and skipped otherwise.
- **Server:** `agy mcp add multi-account-netlify -- <node> <cli> serve`, and `agy mcp remove` to undo it. The entry goes into Antigravity's config, `~/.gemini/config/mcp_config.json`.
- **Skill:** `~/.gemini/config/skills/netlify-accounts/SKILL.md`. The folder is the one Antigravity reads for user skills, in the same layout as its bundled skills.
- **Restart:** Antigravity loads servers and skills when it starts.
- **Verified:** `agy mcp list` shows the server as `enabled`. The skill location was confirmed from the Antigravity binary and from its bundled skills. A live model run was not used to confirm that Antigravity loads the skill.

## The skill

The skill is one file, `plugins/multi-account-netlify/skills/netlify-accounts/SKILL.md`, in the package. Every agent gets a copy of that same file. It tells the agent:

- how to choose an account, and what a list, `all` or a missing account means;
- that changes need one account, and to confirm the account and the effect before running one;
- how to handle secrets and personal data that a read can return;
- that an account can be added in the chat with `account_add`, after the user asks and with a name agreed, that a token is added in a terminal, and that a token is never pasted into the chat.

The tool descriptions carry the rules for each operation too, so an agent without the skill still sees them in its tool list. See [MCP.md](MCP.md#how-the-tools-describe-themselves).

## Limits

- **Codex and Antigravity skill discovery** was checked by location and format. A live run that makes the model use the skill is still to be done.
- **Antigravity has no project scope**, and Codex has no local scope.
- **Windows only** is tested. The `.cmd` shims that npm creates for `codex` and `opencode` on Windows are handled, but the other platforms are untested.
- **Claude Code's marketplace** is kept after uninstall, as described above.
- **opencode.jsonc** is not supported.
- **Restarts are needed** after every install, update or account change, for every agent.
