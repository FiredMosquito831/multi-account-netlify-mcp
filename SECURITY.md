# Security

## Supported versions

The latest published version on npm receives security fixes. Older versions do not.

| Version | Supported |
|---|---|
| 0.1.x (latest) | yes |
| earlier | no |

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue for them.

Use GitHub's private vulnerability reporting for this repository: the **Security** tab, then **Report a vulnerability**. Include what you found, how to reproduce it, and which version you tested. Remove real tokens and account data from anything you send.

You can expect an acknowledgement, and a fix or a plan for one, as soon as the maintainer can make time. A fix ships as a new version, because published versions are never changed.

## What this project protects, and how

- **Tokens** are stored in the operating system's credential store, one entry per account. They are never written to `accounts.json`, to agent config files, to logs, or to command output.
- **Each account's server process** gets only its own token, and an empty config folder, so it cannot read your own Netlify CLI login.
- **Login** runs in a throwaway profile folder, which is deleted afterwards.
- **Changes** run on one account. A list or `all` is refused for a change, before any account is contacted.
- **Agent config files** are backed up before a change, and a file that is not valid is never overwritten.
- **Commands** run without a shell. A Windows `.cmd` shim is run through `cmd.exe` only after its arguments are checked.

The details, and what is not protected, are in [docs/SAFETY.md](docs/SAFETY.md) and [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

## Things to know

- A token that you paste into a chat is in that chat's history. Use `add <name> --pat`, which takes the token in the terminal.
- The agent can make any change that its own permissions allow, on the account it names. Keep the permission rules for the Netlify tools tight.
- A deploy uploads the whole folder you point it at. Keep secrets out of that folder.
