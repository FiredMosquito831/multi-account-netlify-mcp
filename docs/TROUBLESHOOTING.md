# Troubleshooting

Find your message below. Each entry says what it means and what to do.

Start with `multi-account-netlify-mcp doctor`. It shows the agents, the accounts and the token checks in one place.

## Accounts

**`No Netlify accounts are set up yet. Run: multi-account-netlify-mcp add <name>`**
You have no account. Add one: `multi-account-netlify-mcp add work`.

**`No default account is set. Pass account as one of: work, personal, or "all".`**
You have several accounts and no default, and the call did not name one. Ask the agent to name an account, or set a default: `multi-account-netlify-mcp default work`.

**`Unknown account: ghost. Known accounts: work, personal.`**
The name is not one you added. Use one of the known names, or add the account.

**`No stored token for account "work". Add it again with: multi-account-netlify-mcp add work`**
The account is in `accounts.json`, but its token is missing from the credential store. Remove it and add it again: `remove work`, then `add work`.

**`Netlify rejected this token (HTTP 401).`** (or a 403)
The token was revoked or expired. Create a new personal access token in Netlify and add the account again with `remove <name>` and `add <name> --pat`. Restart the agent afterwards.

**`doctor` shows `NO TOKEN in the credential store`**
Same as above. The record exists, the token does not.

**`Could not start the login` or `netlify login exited with code ...`**
The browser login did not finish. Run `add` again. If no browser is available, use `add <name> --pat` instead.

**`An account named "work" already exists.`**
Remove the old account first, or pick another name.

**`This Netlify login is already added as "work".`**
The login you signed in with is already an account under another name. Use that name.

### Adding an account from the chat

- **No browser opened.** The Netlify CLI opens the sign-in in a browser. If none opens, for example on a machine without a screen, the call fails. Run `multi-account-netlify-mcp add <name>` in a terminal instead, which shows the link.
- **The call waited for six minutes.** The sign-in was not finished in time, or its window was closed. Nothing was stored. Try again.
- **"A login for that name is already running".** A login for that name is still waiting in the browser. Finish or close that window, then try again once the call has returned.
- **"An account named ... already exists".** Remove the old account first with `remove <name>`, or choose another name.
- **"Netlify rejected this token".** The sign-in did not give a token that Netlify accepts. Try again, or add the account with `add <name> --pat`, using a token from Netlify's user settings.
- **The new account does not show.** Restart the agent. The `account` argument lists the account names when the agent starts.
- **A folder stays in the data folder after a login.** On Windows, a browser that still has the login profile open keeps some of its files. The token file is deleted first, so only browser files can remain. The folder can be deleted once that browser is closed.

## Calls

**`"deploy-site" runs on one account only, because it can change data or is not classified yet.`**
A change was sent to a list or to `all`. Name one account, for example `account: "work"`. This is intended.

**`Not found in any account: one, two.`**
You asked for an operation that needs an id (a project, deploy, team or site), and none of the accounts owns that id. Check the id, or ask for the project list first (`get-projects`), which can search by name.

**A multi-account result lists `notFoundIn`.**
Those accounts do not own the id. That is expected. The answer comes from the account that does.

**One account shows `"ok": false` with `Failed to fetch API: 503` (or another status)**
That account could not be reached or answered with an error. The others are still shown. Try that account on its own later.

**A long call stops with a timeout**
A tool call can take up to 15 minutes. A large `deploy-site` upload can be long. Claude Code may have its own limit for a tool call, which this tool does not control.

**The agent does not see a new account, or a new token is not used**
The account list in a tool's description is read when the agent starts, and a running server keeps the token it started with. Restart the agent.

## Installs

**`claude is not on PATH` or `Could not start "claude"`**
Claude Code is not installed, or its `claude` command is not on PATH. Install it, or open a new terminal so PATH is refreshed.

**`codex is not on PATH`**, **`agy is not on PATH`**
The agent is not installed, or its command is not on PATH. The install is skipped for that agent. Install the agent, then run `install <agent>` again.

**`codex has no local scope. Use global or project.`**, **`Antigravity has no project scope. Use global.`**
The agent does not support that scope. Use one it supports. When you did not name the agent, the install skips it with this message instead.

**`opencode`: `... is not valid JSON, so it was not changed`**
The opencode config file has a syntax error, or it contains comments (JSONC). Fix the file by hand, then run the install again. The file was not changed.

**`An argument cannot be passed through cmd.exe: ...`**
On Windows, `codex` and `opencode` are `.cmd` shims, and an argument with a double quote, a percent sign, or a line break cannot be passed through `cmd.exe`. Move the project folder or the package to a path without those characters.

**`Unknown option: --scpe`**, **`--scope needs a value.`**
A typo, or a missing value. The install did nothing.

**`Unknown agent: cursor. Valid: claude, codex, opencode, antigravity, or all.`**
Only the four agents are supported.

**Codex does not use the project server**
Codex reads `.codex/config.toml` only in a folder you have trusted. Trust the folder in Codex.

**Codex complains about `CODEX_HOME`**
Codex needs its home folder to exist before it runs. Create the folder named in `CODEX_HOME`, or unset the variable.

**The server appears twice**
You have the official `netlify` MCP server configured as well. Remove that entry, or uninstall this one. The official server's tools have the same names.

**A skill does not appear in the agent**
Restart the agent. Codex and Antigravity read skills when they start. Check that the skill file is where [AGENTS.md](AGENTS.md) says it should be.

**`doctor` says `DISABLED here` for a project install**
The Claude Code plugin is disabled in this folder. Enable it with `/plugin`, or reinstall with `install --scope project`.

**`doctor` says `active when Claude Code runs in that folder`**
A project or local install of another folder. It is only active when Claude Code runs there. This is normal.

**`update` says `not installed in the ... scope`**
`update` refreshes installs that exist. To add one, run `install`.

**`uninstall` says `is not installed ... here`**
Nothing was installed in the scope you asked for. Check with `doctor`.

## Claude Code

**The plugin is installed, but its tools do not appear**
Restart Claude Code. Run `/mcp` to check that the `netlify` server is connected.

**The plugin's server does not start, and `doctor` warns that `multi-account-netlify-mcp` is not on PATH**
The plugin starts the command from PATH. Install the package with `npm install -g multi-account-netlify-mcp`, open a new terminal, check with `multi-account-netlify-mcp --help`, then restart Claude Code.

**`/plugin` asks for a `cli_path`**
That is an older copy of the plugin. Update it with `claude plugin update multi-account-netlify@multi-account-netlify-mcp`, or run `multi-account-netlify-mcp update`.

**A marketplace is still registered after uninstall**
That is expected. Remove it with `claude plugin marketplace remove multi-account-netlify-mcp` if no folder needs it.

## Antigravity

**`agy mcp list` shows the server, but the tools do not appear**
Restart Antigravity.

## Install and update

**`npm install -g` fails on Windows with a native build error**
The credential-store binding uses prebuilt binaries for common platforms. Use Node.js 22 or newer, on a supported platform, and try again.

**`update` did not pick up a new version**
Run `npm install -g multi-account-netlify-mcp@latest` first, and then `multi-account-netlify-mcp update`. Restart the agents.

## Still stuck?

Run `multi-account-netlify-mcp doctor` and keep the output. Open an issue on GitHub, and leave out tokens and anything from `accounts.json` that you would not want public. Report security problems privately (see [SECURITY.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/SECURITY.md)).
