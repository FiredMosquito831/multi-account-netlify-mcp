---
name: netlify-accounts
description: How to pick Netlify accounts for a tool call in the multi-account-netlify MCP (the account argument, one name, a comma list, all, the default account, per-account errors). Use when a Netlify tool call needs a specific account, when several accounts should be compared, or when the user mentions more than one Netlify account.
---

# Netlify accounts

Every Netlify tool from this plugin takes an optional `account` argument.

- **Left out:** the default account is used. If there is no default and more than one account exists, the call fails and lists the names. Ask the user which one, then call again.
- **One name** (for example `work`): the call runs on that account only, and the result is the same as the official tool's result.
- **A comma list** (for example `work,personal`) or **`all`**: the call runs on each named account. The result is JSON: `{"accounts": {"<name>": {"ok": true, "result": ...}}}`, or `{"ok": false, "error": "..."}` for an account that failed. One failing account does not stop the others, so report each account separately.
- **`netlify-coding-rules`** takes no account. It does not call Netlify.

## Before writes

Updater tools change data. With a list or `all`, one request changes every named account. Confirm with the user before fanning a change out to several accounts, unless they asked for exactly that.

## Accounts changing

Adding, removing or changing the default account is read on each call. A token that was re-added is only picked up after Claude Code restarts, because the running server keeps the token it started with.

## Tokens

Tokens are stored in the operating system's credential store and are never shown. Do not ask the user to paste a token into the chat. Point them to `/multi-account-netlify:add-account <name> --pat`, which takes the token in the terminal.
