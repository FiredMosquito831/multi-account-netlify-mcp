---
description: Add a Netlify account by browser login, or with a personal access token (--pat)
argument-hint: <name> [--pat]
allowed-tools: Bash(multi-account-netlify-mcp:*)
---
Add a Netlify account named "$1".

For a browser login, call the account_add tool with the name "$1". A browser window opens with a new profile, and the user signs in there with the account to add. The call waits for that sign-in, for up to six minutes.

If the user passed `--pat`, or wants a personal access token, the token is typed in the terminal and hidden there. Tell the user to type this in the prompt, exactly:

! multi-account-netlify-mcp add $1 $2

Claude never asks for or handles the token itself.

When it finishes, run `/multi-account-netlify:accounts` to confirm the account is listed.
