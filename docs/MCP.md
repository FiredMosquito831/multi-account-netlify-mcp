# The MCP server

This page describes what an agent sees when it connects to the server: the tools, the `account` argument, how calls are routed, what the results look like, and how this server compares with the official Netlify MCP server.

## The tools

The server exposes the same tools as the official `@netlify/mcp` server in local mode. There are ten official tools:

| Tool | Read or change | Operations |
|---|---|---|
| `netlify-coding-rules` | read (no account) | returns the Netlify coding rules. It does not call Netlify. |
| `netlify-user-services-reader` | read | `get-user` |
| `netlify-deploy-services-reader` | read | `get-deploy`, `get-deploy-for-site` |
| `netlify-deploy-services-updater` | change | `deploy-site` |
| `netlify-team-services-reader` | read | `get-teams`, `get-team`, `get-team-env-vars` |
| `netlify-project-services-reader` | read | `get-project`, `get-projects`, `get-forms-for-project` |
| `netlify-project-services-updater` | change | `create-new-project`, `update-project-name`, `update-forms`, `update-visitor-access-controls`, `manage-form-submissions`, `manage-env-vars` |
| `netlify-extension-services-reader` | read | `get-extensions`, `get-full-extension-details`, `initialize-database` |
| `netlify-extension-services-updater` | change | `change-extension-installation` |
| `netlify-observability-services-reader` | read | `get-counts`, `get-topk`, `get-timeseries`, `get-request-logs`, `get-request-detail` |

Each tool takes an `operation` and its `params`, as the official server defines them. This server does not change them. The only addition is the `account` argument.

Tool names are the official names, with no account in them. Adding an account does not add tools.

Two more tools manage the accounts. They are not official tools, and they never reach a Netlify child:

| Tool | What it does |
|---|---|
| `account_add` | adds an account by browser login, in the chat. See [Adding accounts from the chat](#adding-accounts-from-the-chat). |
| `account_list` | lists the accounts, with their emails and the default. Tokens are never shown. |

## The `account` argument

Every tool except `netlify-coding-rules` takes an optional `account` string:

| Value | Meaning |
|---|---|
| left out | the default account (see [ACCOUNTS.md](ACCOUNTS.md#the-default-account)). With no default and more than one account, the call fails and lists the names. |
| `work` | one account, by name. The result is the official result, unchanged. |
| `work,personal` | a comma-separated list. Only for operations that allow it. |
| `all` | every account. Only for operations that allow it. |

Names are case-insensitive, and spaces around commas are ignored. An unknown name is refused, and the error lists the known names.

## Which operations can use several accounts

Each operation has one of three modes. The mode decides what a list or `all` does.

| Mode | Meaning |
|---|---|
| **all** | every named account answers, and every answer is shown. For reads that need no id. |
| **locate** | every named account is asked, and only the account that owns the id answers. Accounts without it are listed under `notFoundIn`. For reads that need an id. |
| **one** | exactly one account. A list or `all` is refused with an error. For every change. |

| Operation | Mode | Why |
|---|---|---|
| `get-user` | all | who you are on each account |
| `get-teams` | all | the teams of each account |
| `get-projects` | all | the project list. Its `projectNameSearchValue` finds a project by name across accounts. |
| `get-extensions` | all | the extensions of each account |
| `initialize-database` | all | returns setup instructions only; it provisions nothing |
| `get-deploy` | locate | needs a deploy id |
| `get-deploy-for-site` | locate | needs a site id |
| `get-team` | locate | needs a team id |
| `get-team-env-vars` | locate | needs a team id |
| `get-project` | locate | needs a site id |
| `get-forms-for-project` | locate | needs a site id |
| `get-full-extension-details` | locate | needs a team and an extension |
| `get-counts`, `get-topk`, `get-timeseries` | locate | need a site id |
| `get-request-logs`, `get-request-detail` | locate | need a site id (and a request id for the detail) |
| `deploy-site` | one | uploads a folder from this computer |
| `create-new-project` | one | creates a site |
| `update-project-name` | one | renames a site |
| `update-forms` | one | enables or disables Netlify Forms |
| `update-visitor-access-controls` | one | changes who can see a site |
| `change-extension-installation` | one | installs or removes an extension |

Two operations change data and also read it. Each is decided by its parameters:

| Operation | Read (listing or viewing) | Change |
|---|---|---|
| `manage-env-vars` | `getAllEnvVars`: locate | `upsertEnvVar`, `deleteEnvVar`: one |
| `manage-form-submissions` | `action: get-submissions`: locate | `action: delete-submission`: one |

An operation that is not in the table counts as **one**, so it is never fanned out by accident. The test suite compares the table with the official server's operations, so a new operation in an official update is caught before it ships. See [DEVELOPMENT.md](DEVELOPMENT.md#adding-an-operation).

Sensitive reads (environment variable values, form submissions, request logs) are not a separate mode. They are reads, so they follow the mode above. The rules about what to do with them are in [SAFETY.md](SAFETY.md).

## Results

### One account

The official result is returned unchanged, including its content and its `isError` flag. Nothing is added or removed.

### Several accounts

The result is a JSON document with one entry per account:

```json
{
  "accounts": {
    "work": { "ok": true, "result": { "content": [ ... ] } },
    "personal": { "ok": false, "error": "Failed to fetch API: 503" }
  }
}
```

- Each entry has `ok`. When it is `true`, `result` is the official result for that account. When it is `false`, there is an `error` (the account could not be asked) or a `result` (the official server answered with an error).
- One failing account does not stop the others.
- A list in `locate` mode also has `notFoundIn`: the names of the accounts that do not own the id. Those accounts are left out of `accounts`, because they did not fail. They simply do not have it.
- The result is marked as an error only when no account answered.
- If every account in `locate` mode reports not found, the error says `Not found in any account: <names>`.

Not-found is recognized from the text the official server returns (`404`, `not found`, or `do not exist` in a short answer). A real authentication failure is never mistaken for not-found.

### Errors before any account is asked

These come back as an error result, and no account is contacted:

- no accounts yet: `No Netlify accounts are set up yet. Run: multi-account-netlify-mcp add <name>`;
- no default and several accounts: `No default account is set. Pass account as one of: ...`;
- an unknown name: `Unknown account: ...`;
- a change sent to a list or to `all`: `"deploy-site" runs on one account only, because it can change data or is not classified yet. Name one account, for example account: "work".`
- an unknown tool name: `Unknown tool "...".`

## Limits and timing

- **Fan-out** runs at most 4 calls at a time (`FANOUT_LIMIT`). Netlify's rate limits apply per account.
- **A single tool call** may take up to 15 minutes. The SDK's default is 60 seconds, which is too short for a large `deploy-site` upload. Claude Code may have its own limit for a tool call. That is not verified.
- **Stopped children** are started again on the next call.
- **Account changes** are read on each call (`accounts.json`), so a new account or a new default is seen immediately. A token that was changed is only used after the server restarts, because each running server keeps the token it started with.

## How the tools describe themselves

Each tool's description ends with a paragraph that lists how each of its operations can use several accounts, taken from the same table:

```text
Multi-account (the account argument): get-project: only the account that owns the id answers, and accounts without it are listed under notFoundIn; get-projects: every named account answers; ...
```

The `account` argument's description says that lists and `all` only work for operations that allow them, that changes need one name, and which accounts exist. An agent that never reads a skill still sees these rules, because they are in the tool list.

## Adding accounts from the chat

The `account_add` tool adds an account with the same browser login as `multi-account-netlify-mcp add <name>`. The agent calls it when the user asks, with a name the user has agreed:

1. The server checks the name, and that no login for that name is already running.
2. The Netlify CLI runs `netlify login` in a throwaway profile, with the login source set to `mcp`, as the official server does. A browser window opens.
3. The user signs in there with the account to add. The browser uses a new profile, so it does not use the sign-in of the user's own browser.
4. The call returns when the sign-in finishes, or after six minutes. The token is checked with Netlify, stored in the credential store, and the account is saved.

The call answers with the account it added, or with the reason it failed. A login link is never shown in the chat, because it is a sign-in ticket. If the browser does not open, run `multi-account-netlify-mcp add <name>` in a terminal, which shows the link.

A token is never typed into the chat. For a personal access token, the user runs `multi-account-netlify-mcp add <name> --pat` in a terminal.

The new name shows in the `account` argument after the agent restarts. `account_list` shows the accounts at any time.

## What the server does not expose

Compared with the official server in local mode, this server keeps everything: all ten tools, every operation and every parameter, and the result contents. It adds the two account tools. What it does not expose:

- **`--verbose` mode** of the official server, which registers one tool per operation. This server relies on the grouped form, where an operation is chosen with `selectSchema`. The policy needs that form to decide each call.
- **`--proxy-path`**, the official package's command-line deploy mode. It is a command-line tool, not an MCP tool.
- **Progress and logging notifications.** The official server does not send any, so nothing is lost.
- **Prompts and resources.** The official server has none.

## Compared with the official server

| | Official `@netlify/mcp` | multi-account-netlify-mcp |
|---|---|---|
| Accounts | one per process, from `NETLIFY_PERSONAL_ACCESS_TOKEN` or the Netlify CLI login | any number, each with its own login or token |
| Tools | ten, one account | the same ten, with the `account` argument, plus `account_add` and `account_list` |
| Adding an account in the chat | the official server runs `netlify login` when a call finds no token | `account_add` runs the same login, and the account is stored with its name |
| Result | the official result | the official result, or one entry per account |
| Changes on several accounts | not applicable | refused |
| Install | by hand, in each client's config | `install` for four agents, with scopes, a plan and a clean uninstall |

## Using the server by hand

Agents start the server for you. To test it yourself, run `multi-account-netlify-mcp serve` and connect with any MCP client that speaks stdio. The integration tests in `src/test/integration.test.ts` do exactly this.
