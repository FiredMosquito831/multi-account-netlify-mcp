# Accounts and tokens

An account is one Netlify login, given a short name such as `work` or `personal`. This page covers how accounts are added, where their tokens live, how the default works, and how they are removed.

## Adding an account

There are two ways.

**With a browser login** (the default):

```sh
multi-account-netlify-mcp add work
```

This runs `netlify login` in a separate profile folder, under the data folder, so your own Netlify CLI login is never read or changed. A browser window opens. Sign in with the account you want to call `work`. When the login finishes, the token is read from the profile, and the profile folder is deleted.

**With a personal access token**, when no browser is available:

```sh
multi-account-netlify-mcp add work --pat
```

The command asks for the token. The input is hidden while you type it. Create a token in Netlify under your user settings, under OAuth, as personal access tokens.

Either way, the token is checked before it is stored. The check calls `GET /api/v1/user`. If Netlify refuses the token, nothing is stored, and the command reports the HTTP status.

## What gets stored

| Where | What | Notes |
|---|---|---|
| Windows Credential Manager | the token, one entry per account | service `multi-account-netlify-mcp`, account name = the account name |
| `accounts.json` in the data folder | name, email, user id, how it was added (`login` or `pat`), date | never a token |

The data folder is `%LOCALAPPDATA%\multi-account-netlify-mcp` on Windows. See [CONFIGURATION.md](CONFIGURATION.md#the-data-folder).

A token is never written to an agent's config, to a log, or to a command's output. `list` and `doctor` show whether a token is accepted, not the token itself.

## Names

- 1 to 32 characters.
- Lowercase letters, digits and hyphens. The first character is a letter or a digit.
- `all` is reserved, because it means every account in a call.
- A name that is already used is refused. Remove the old account first to replace it.
- The same Netlify login cannot be added under two names. The check uses the user id that Netlify returns.

## The default account

A tool call that does not name an account uses the default account.

- The first account you add becomes the default.
- Change it with `multi-account-netlify-mcp default <name>`, or `/multi-account-netlify:set-default <name>` in Claude Code.
- With no default and several accounts, a call that does not name one is refused, and the error lists the names. The agent should then ask which one to use.
- With exactly one account and no default, that account is used.
- Removing the default account leaves no default.

## Listing

```sh
multi-account-netlify-mcp list
```

```text
* work      you@example.com       login
  personal  you+2@example.com     pat
```

`*` marks the default. `doctor` shows whether each account's token is still accepted.

## Removing an account

```sh
multi-account-netlify-mcp remove personal
```

This deletes the account's token from the credential store and removes its line from `accounts.json`. It does not change any agent's install, and it does not revoke the token at Netlify. To revoke it, delete the token in Netlify's user settings.

## Tokens that stop working

A token can be revoked or expire. Then calls to that account fail, with an error such as `Netlify rejected this token (HTTP 401)`, and `doctor` reports the same. To fix it, add the account again with a new token:

```sh
multi-account-netlify-mcp remove work
multi-account-netlify-mcp add work
```

Restart the agents afterwards. A running server keeps the token it started with, so a new token is not used until the server starts again.

## How the server uses a token

- Each account has its own server process. The process gets that account's token in its environment, as `NETLIFY_PERSONAL_ACCESS_TOKEN`, and no other account's token.
- The process also gets an empty config folder, so it cannot read your main Netlify CLI login, and it never starts a browser login of its own.
- The process is started the first time an account is used, and it stays running until the agent closes the server.

## Isolation during login

`add` (without `--pat`) runs `netlify login` with these environment variables pointed at a throwaway folder under the data folder:

- `APPDATA`, `LOCALAPPDATA` and `XDG_CONFIG_HOME`, where the Netlify CLI keeps its config;
- `HOME` and `USERPROFILE`, so the CLI cannot read or merge `~/.netlify/config.json`.

It also removes `NETLIFY_AUTH_TOKEN` and `NETLIFY_PERSONAL_ACCESS_TOKEN` from the environment it passes on, so an existing token cannot short-circuit the login. The folder is deleted when the login finishes, whether it succeeded or not.

## Accounts and agents

Adding or removing an account does not touch any agent. The agents see accounts through the server, which reads `accounts.json` on each call. The server's tool list, including the account names in the `account` description, is read when the agent starts, so restart the agent to see a new account in the description.
