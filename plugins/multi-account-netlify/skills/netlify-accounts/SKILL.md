---
name: netlify-accounts
description: How to choose Netlify accounts and act safely across them in the multi-account-netlify MCP (the account argument, one name, a comma list, all, the default account, which operations can span accounts, what to confirm before a change, and how to handle secrets). Use when a Netlify tool call needs a specific account, when several accounts should be compared, or when the user mentions more than one Netlify account.
---

# Netlify accounts

Every Netlify tool from this server takes an optional `account` argument. Each tool's description lists which of its operations may use several accounts. This guide adds how to act on that.

## Choosing accounts

- **Left out:** the default account. If there is no default and more than one account exists, the call fails and lists the names. Ask the user which one, then call again.
- **One name** (for example `work`): the call runs on that account only, and the result is the official result.
- **A comma list or `all`:** allowed only for operations that allow it. The result is JSON, `{"accounts": {"<name>": {"ok": true, "result": ...}}}`. An account that failed has `ok: false` with an `error` or a `result`. One failing account does not stop the others, so report each account separately.
- **Operations that need an id** (a project, deploy, team, or site id) with a list or `all`: every named account is asked, and only the account that owns the id answers. Accounts without it are listed under `notFoundIn`. Say which account answered.
- **Changes** (deploy, create or rename a project, change forms, change an extension, change or delete env vars, delete form submissions): always one name. A list or `all` is refused with an error. If the account is not clear, ask the user.
- **Operations that are not in the server's table** count as changes until they are added. If one is refused, tell the user why.
- **`netlify-coding-rules`** takes no account, and it does not call Netlify.

## Before a change

- A change on one account still changes data. Say what it will do before you run it: for `deploy-site`, the folder being uploaded and the site it goes to.
- Never try to send a change to several accounts. The server refuses it, and you should not work around that.

## Sensitive data

Env var values, form submissions, and request logs can be read across all accounts. Summarize them. Do not repeat secret values or personal data from submissions back to the user unless they ask for exactly that.

## Adding and removing accounts

- **Adding in the chat.** When the user asks to add an account, agree its name with them, then call `account_add` with that name. A browser window opens with a new profile, and the user signs in there with the account to add. The call waits for the sign-in, for up to six minutes, then reports the result. Tell the user to finish the sign-in in that window.
- **Listing.** `account_list` shows the accounts, their emails and the default. It never shows a token.
- **Adding with a token, removing, and choosing the default** happen in a terminal: `multi-account-netlify-mcp add <name> --pat` (the input is hidden), `list`, `default <name>`, `remove <name>`, and `doctor`. In Claude Code the same actions are `/multi-account-netlify:add-account`, `/multi-account-netlify:accounts`, `/multi-account-netlify:set-default`, `/multi-account-netlify:remove-account`, and `/multi-account-netlify:doctor`.

Never ask the user to paste a token into the chat. Tell them the terminal command for a token instead.

## After account changes

A new account appears in the account argument after the agent restarts. The account list and the default account are read on each call. A token that was added again is picked up after the agent restarts, because the running server keeps the token it started with.
