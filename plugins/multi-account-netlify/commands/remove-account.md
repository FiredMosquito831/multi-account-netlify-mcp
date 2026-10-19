---
description: Remove a Netlify account and its stored token
argument-hint: <name>
allowed-tools: Bash(multi-account-netlify-mcp:*)
---
Removing the account named "$1" deletes its stored token from this computer. Ask the user to confirm by typing the account name back. Do not run anything until they answer clearly.

Only after a clear yes, run `multi-account-netlify-mcp remove $1` with the Bash tool, then report the result.
