---
description: Add a Netlify account, with a browser login or a personal access token (--pat)
argument-hint: <name> [--pat]
allowed-tools: Bash(multi-account-netlify-mcp:*)
---
Add a Netlify account named "$1".

The login opens a browser and waits for the user, so Claude cannot run it. Tell the user to type this in the prompt, exactly:

! multi-account-netlify-mcp add $1 $2

If they pass `--pat` as the second argument, the command asks for a personal access token instead, and the token is hidden while typed. Claude never asks for or handles the token itself.

When the user says it finished, run `/multi-account-netlify:accounts` to confirm the account is listed.
