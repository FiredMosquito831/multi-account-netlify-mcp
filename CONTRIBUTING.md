# Contributing

Thank you for looking at this project. It is small, and it aims to stay easy to read and to test.

## Before you start

- Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the code layout and the conventions.
- For a larger change, open an issue first, so we can agree on the approach. Changes to how calls are routed, or to what the installers write, need a clear reason.

## Making a change

1. Fork the repository and create a branch.
2. Run `npm install`, then `npm test`. All tests must pass on Windows and on Ubuntu.
3. Add tests for the behaviour you change. The tests use `node:test` and temporary folders. See [docs/TESTING.md](docs/TESTING.md).
4. Update the documentation in the same change: [README.md](README.md), the files in `docs/`, and [CHANGELOG.md](CHANGELOG.md) if the change is user-facing.
5. Open a pull request. Describe what changed, why, and how you tested it, including any live checks.

## Rules that matter here

- **Changes stay on one account.** Do not add a way to send a change to several accounts.
- **Never write a token to a file or to output.**
- **Only touch what this tool wrote.** Installers record their entries, and uninstall removes only those.
- **Back up before you edit** an agent's file, and refuse a file that is not valid.
- **Do not add a dependency casually.** New packages change what users install.

## Releases

Releases are made by the maintainer, following [docs/RELEASING.md](docs/RELEASING.md). A pull request does not change the version number.

## Security

Do not report security problems in a public issue. See [SECURITY.md](SECURITY.md).
