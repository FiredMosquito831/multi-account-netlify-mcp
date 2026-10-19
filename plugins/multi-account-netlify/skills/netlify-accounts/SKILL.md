---
name: netlify-accounts
description: How to pick Netlify accounts for a tool call in the multi-account-netlify MCP (the account argument, one name, a comma list, all, the default account, which operations may span accounts, per-account errors). Use when a Netlify tool call needs a specific account, when several accounts should be compared, or when the user mentions more than one Netlify account.
---

# Netlify accounts

Every Netlify tool from this plugin takes an optional `account` argument.

- **Left out:** the default account. If there is no default and more than one account exists, the call fails and lists the names. Ask the user which one, then call again.
- **One name** (for example `work`): the call runs on that account only, and the result is the official result.
- **A comma list or `all`:** allowed for reads only. The result is JSON, `{"accounts": {"<name>": {"ok": true, "result": ...}}}`. An account that failed has `ok: false` and an `error` or `result`. One failing account does not stop the others, so report each account separately.
- **Reads that need an id** (a project, deploy, team, or site id) with a list or `all`: every named account is asked, and only the account that owns the id answers. Accounts without it are listed under `notFoundIn`. Say which account answered.
- **Writes** (deploy, create or rename a project, change forms, change an extension, change or delete env vars, delete form submissions): always one account. A list or `all` is refused with an error. If the account is not clear, ask the user.
- **Operations not in the policy table** count as writes until they are added. If one is refused, tell the user why.
- **`netlify-coding-rules`** takes no account. It does not call Netlify.

## Sensitive reads

Env var values, form submissions, request logs and their details can be read across all accounts. Summarize them, and do not repeat secret values back to the user.

## Accounts changing

Adding, removing or changing the default account is read on each call. A token that was re-added is only picked up after Claude Code restarts, because the running server keeps the token it started with.

## Tokens

Tokens are stored in the operating system's credential store and are never shown. Do not ask the user to paste a token into the chat. Point them to `/multi-account-netlify:add-account <name> --pat`, which takes the token in the terminal.
