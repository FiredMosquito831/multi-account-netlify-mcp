# Safety

What this tool refuses, what needs your confirmation, and how it handles secrets and personal data. Read this before you let an agent act on several accounts.

## Changes stay on one account

Anything that changes data runs on exactly one account. The server refuses a list or `all` for every change, before any account is contacted. The refusal names the operation and tells the agent to name one account.

Changes include:

- deploying a folder (`deploy-site`)
- creating a project (`create-new-project`), renaming one (`update-project-name`)
- enabling or disabling forms (`update-forms`), and changing who can see a site (`update-visitor-access-controls`)
- installing or removing an extension (`change-extension-installation`)
- creating, changing or deleting an environment variable (`manage-env-vars`)
- deleting a form submission (`manage-form-submissions`)

Operations the table does not know count as changes until they are classified. A new operation in an official update therefore never reaches several accounts by accident.

## Reads can span accounts

Reads are safe to send to several accounts: they change nothing. The modes are in [MCP.md](MCP.md#which-operations-can-use-several-accounts). Two cases need care, because the answer goes into the conversation:

- **Secrets.** Environment variable values can be read on every account. Values of variables marked secret are not returned by Netlify for team variables. For site variables, the official server returns Netlify's answer as it is, and this tool does not hide anything in it. Treat what you see there as sensitive.
- **Personal data.** Form submissions contain whatever your visitors typed. Request logs contain client addresses. Reading them on every account puts that data into the conversation for every account at once.

The agent guide tells agents to summarize these reads and not to repeat secrets or personal data back to you unless you ask for exactly that. A guide cannot force that, so check what an agent is about to paste into a chat.

## The `deploy-site` upload

`deploy-site` takes an absolute path on your computer and uploads that folder to Netlify. It is the one operation that sends local files off the machine.

- The official server zips the folder into a file named `deploy-<time>-<id>.zip` inside that folder, uploads it, and deletes the zip.
- The folder is uploaded in full, so keep secrets such as `.env` files out of it, or out of the folder you point at.
- The call can take up to 15 minutes, because of the upload.

Always confirm the folder and the site before a deploy. The agent guide asks the agent to say what it will upload before it runs `deploy-site`.

## Confirmation

This tool does not ask you to confirm each call. The MCP protocol does not give servers a way to do that, and agents differ in how they ask. Two things help:

- The tool descriptions say which operations change data, and the account guide tells agents to confirm the account and the effect first.
- Agents ask for permission to run tools according to their own settings. In Claude Code, check the permission rules for the `netlify` tools in your settings if you want a prompt before each change.

## Tokens and credentials

- Tokens are stored only in the OS credential store. They are never written to `accounts.json`, to an agent's config, to a log, or to a command's output.
- Each account's server process gets only its own token, through its environment. The server does not hold a token for another account.
- The login for `add` runs in a throwaway folder, so your own Netlify CLI login is never read or changed.
- A token that is leaked should be revoked in Netlify's user settings, then replaced with `remove <name>` and `add <name> --pat`.

## Agent configuration files

- Each change to an agent's file is preceded by a `.bak` copy, for the opencode JSON file.
- A file that is not valid JSON or TOML is not changed. The install stops and reports it.
- Only this tool's own entries and skill folders are written or removed. Other servers and settings are kept.
- The server entries hold this computer's `node` and `dist/cli.js` paths. Do not commit a project's agent files that hold them.

## What is not protected

- **The agent can still do what it is allowed to do.** If a change is allowed on one account, the agent can make it. Keep your agent's permission rules tight for Netlify tools.
- **Several accounts read at once** means several rate limits and several sets of data in one answer. The answer is large by design.
- **Revoked or expired tokens** fail for that account only. Other accounts keep working.
- **Netlify's own rules** still apply. For example, a site's visitor-access settings are the site's, whichever account you used.

## Reporting a problem

If you find a way to make a change run on several accounts, or a way to read a token, report it privately. See [SECURITY.md](https://github.com/FiredMosquito831/multi-account-netlify-mcp/blob/main/SECURITY.md).
