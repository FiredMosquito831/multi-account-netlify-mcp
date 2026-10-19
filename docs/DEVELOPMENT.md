# Development

How the code is organized, how to add an agent or an operation, and the conventions to keep.

## Setup

```sh
git clone https://github.com/FiredMosquito831/multi-account-netlify-mcp.git
cd multi-account-netlify-mcp
npm install
npm test
```

Node 22 or newer. The code is TypeScript, compiled with `tsc` to `dist/`. Imports between files use the `.js` extension, because the output is ES modules.

## Code layout

```text
src/
  cli.ts                       commands: add, list, default, remove, install, update, uninstall, doctor, serve
  paths.ts                     the data folder, and the package root
  version.ts                   the package version, read from package.json

  accounts/registry.ts         accounts.json: names, validation, the default, add and remove
  secrets/token-store.ts       the credential store (one entry per account)
  netlify/api.ts               GET /api/v1/user, to check a token
  login/netlify-cli-login.ts   `netlify login` in a throwaway profile, and reading its token

  mux/server.ts                the MCP server: tools/list and tools/call
  mux/policy.ts                the mode of each operation (all, locate, one) and the mixed operations
  mux/routing.ts               the account argument, to a set of accounts
  mux/fanout.ts               the concurrency limit for fan-out
  mux/multiplexer.ts           one child process per account, and the catalog child
  mux/official-child.ts        one official @netlify/mcp process, with its isolated environment
  mux/catalog.ts               the account argument, and the multi-account notes in each tool description

  install/claude-plugin.ts     the claude plugin commands (marketplace, install, update, uninstall, list)

  agents/types.ts              AgentId, scopes, Step, Context, and the AgentAdapter interface
  agents/command.ts            command runner (no shell; Windows .cmd shims through cmd.exe)
  agents/state.ts              the ownership record per agent and scope
  agents/skill.ts              copying and removing the account skill
  agents/claude.ts             the Claude Code adapter (wraps install/claude-plugin.ts)
  agents/codex.ts              the Codex adapter
  agents/opencode.ts           the opencode adapter
  agents/antigravity.ts        the Antigravity adapter
  agents/dispatch.ts           runs an action over the agents, with the skip and error rules
  agents/install-flow.ts       argument parsing, the guided questions, and the command line shown

  test/                        the tests (see TESTING.md)

plugins/multi-account-netlify/
  .claude-plugin/plugin.json   the plugin manifest
  .mcp.json                    the server, run as node ${user_config.cli_path} serve
  commands/                    the five account commands
  skills/netlify-accounts/     the account skill, copied to every agent

.claude-plugin/marketplace.json  the Claude Code marketplace
```

## How a call flows

1. An agent calls a tool. The server (`mux/server.ts`) reads the `account` argument.
2. `selectionOf` reads the operation and its parameters from `selectSchema`, and `modeFor` gives the mode.
3. `resolveTargets` (`mux/routing.ts`) turns the argument into accounts. A change with more than one account is refused here.
4. One account: the call is passed to that account's child process (`mux/multiplexer.ts`), and its result is returned unchanged.
5. Several accounts: each account is asked, at most four at a time (`mux/fanout.ts`). In `locate` mode, accounts that do not own the id are dropped. The result is one JSON document with an entry per account.

## How an install flows

1. `cli.ts` reads the arguments (`install/install-flow.ts`). In a terminal, it asks for what is missing.
2. `dispatch.ts` chooses the agents: the ones set up here for install and update, all of them for uninstall and doctor.
3. For each agent and scope, the adapter does its work. Adapters throw on errors. The dispatcher turns an error into an `error` line, and carries on with the next agent.
4. Each adapter records what it wrote (`agents/state.ts`), so uninstall removes only that.

## Adding an agent

1. Write `src/agents/<name>.ts` with an `AgentAdapter`. Declare its `scopes`, and implement `present`, `install`, `update`, `uninstall` and `doctor`.
2. Use the agent's own commands where it has them. Edit files only where it does not, and back them up first. Refuse a file that is not valid, and touch only this tool's entries.
3. Record each thing you write with `record`, and remove only recorded things on uninstall. Remove an empty file or folder only if your install created it.
4. Add the adapter to `ADAPTERS` in `src/agents/dispatch.ts`, and to `AGENTS` in `src/agents/types.ts`.
5. Add tests in `src/test/agents.test.ts` (or a new file), with a fake runner and temporary folders.
6. Check it live with a throwaway home, and record what you saw in [TESTING.md](TESTING.md) and [AGENTS.md](AGENTS.md).
7. Update [README.md](../README.md), the docs, `CLAUDE.md`, and the memory notes, in the same change.

## Adding an operation

When the official server adds an operation:

1. `src/test/coverage.test.ts` fails and names it. This is intended.
2. Decide its mode in `src/mux/policy.ts`: `all` for a read with no id, `locate` for a read that needs an id, `one` for any change. A mixed operation goes in `MIXED_OPERATIONS`, and `modeFor` decides it from its parameters.
3. Add a test in `src/test/policy.test.ts`, and check the tool description in `src/test/skills-and-definitions.test.ts`.
4. Update [MCP.md](MCP.md) and [SAFETY.md](SAFETY.md).

Until it is classified, an operation counts as `one`, so it is never fanned out by accident.

## Conventions

- **No shell.** Commands are run with fixed arguments. The only exception is a Windows `.cmd` shim, which goes through `cmd.exe` with arguments checked first (`agents/command.ts`).
- **Never write a token to a file or to output.** Tokens go in the credential store, and into a child process's environment, and nowhere else.
- **Stdout is the protocol in `serve` mode.** Log only to standard error there.
- **Back up before you edit someone else's file**, and refuse a file you cannot parse.
- **Keep the agents isolated.** An adapter does not import another adapter.
- **Write code with the file tools**, not with long shell heredocs, which break on quoting.

## Dependencies

- `@netlify/mcp`: the official server. It is a caret range (`^1.19.0`), so `npm update` brings in its changes. The tests check its contract.
- `@modelcontextprotocol/server` and `@modelcontextprotocol/client`: the MCP SDK, version 2.x.
- `@napi-rs/keyring`: the credential store binding.
- `netlify-cli`: pinned exactly (`27.13.0`). It is used only for `login`.
- `typescript` and `@types/node`: development only.

`npm audit` reports findings in the dependency trees of `@netlify/mcp` and `netlify-cli`. Do not run `npm audit fix --force` blindly: it makes breaking changes.

## Where decisions are recorded

Every decision, with its date and reason, is in `CLAUDE.md`. That file is kept locally and is git-ignored, so it is not in the repository. The changelog is in [CHANGELOG.md](../CHANGELOG.md).
