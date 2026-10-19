# Testing

How the test suite is organized, how to run it, what the live checks covered, and what CI runs.

## Running the tests

```sh
npm test          # builds, then runs every file in dist/test/*.test.js
npm run typecheck # typecheck only
```

One file:

```sh
npm run build
node --test dist/test/agents.test.js
```

The tests use Node's built-in test runner (`node:test`). They need no network access, except that the integration test with a bad token calls Netlify, and it passes whether or not Netlify is reachable.

## What each test file covers

| File | What it checks |
|---|---|
| `registry.test.ts` | account names, adding, removing and the default, duplicates, and that `accounts.json` never holds a token |
| `routing.test.ts` | how the `account` argument becomes a set of accounts: default, one name, lists, `all`, unknown names |
| `policy.test.ts` | the mode of each operation, the mixed operations decided by parameters, and not-found detection |
| `coverage.test.ts` | runs against the installed official package: the policy table must list exactly the operations the official server has |
| `catalog.test.ts` | the `account` argument is added, the coding-rules tool is left alone, and the original tool is not changed |
| `skills-and-definitions.test.ts` | the skill ships and is agent-neutral; Codex and Antigravity skills install and uninstall; the tool descriptions carry the per-operation rules |
| `server.test.ts` | the server end to end, in memory: passing a single result through, fan-out, errors, unknown tools, the neutral child, and the account tools (they never reach a child) |
| `policy-routing.test.ts` | per operation: changes refused on lists, reads fanned out, `locate` dropping accounts that do not own the id, and auth failures kept visible |
| `multiplexer.test.ts` | one child per account, reuse, restart after exit, and close |
| `fanout.test.ts` | the concurrency limit and the order of results |
| `login.test.ts` | reading the token the Netlify CLI writes, the isolated environment, and the child environment |
| `in-chat-login.test.ts` | the six-minute limit of the in-chat login, and the failure message, which never shows a login link |
| `add-account.test.ts` | adding an account from the chat: the name checks, a login already running, a failed login, a rejected token, the same user under a second name, the default, and that the token never reaches the accounts file |
| `account-tools.test.ts` | the two account tools and their schemas, and the account list text (no token, the default marked) |
| `usage.test.ts` | the help text, the server start command, and what runs when no command is given |
| `install.test.ts` | the Claude Code plugin driver, with a fake `claude` that records the calls: marketplace, install, update, uninstall, scopes |
| `agents.test.ts` | argument and answer parsing, the guided questions, the Codex TOML table, the opencode JSON edits (backups, invalid files, cleanup), Antigravity commands, and the dispatcher's skip and error rules |
| `manifests.test.ts` | the marketplace, plugin, launcher, commands, skill and `package.json` agree with each other |
| `integration.test.ts` | the real `@netlify/mcp` package: its tools, the schemas, the coding rules, a bad token, and the `serve` command end to end over stdio |

Tests that change files use temporary folders. Each test gets its own data folder through `MULTI_ACCOUNT_NETLIFY_HOME`, so one test cannot see another test's installs.

## Live checks (not part of `npm test`)

Some behaviour depends on the real agents, so it was also checked live. These were run against throwaway folders and homes, and cleaned up afterwards:

- **Codex, global:** `CODEX_HOME` pointed at a temporary folder. `codex mcp list` showed the server as `enabled`. Install and uninstall both worked.
- **Codex, project:** a temporary project folder. The table was written, the skill was copied, and uninstall removed both, along with the folders it had created.
- **opencode, global:** `HOME` and `USERPROFILE` pointed at a temporary home. `opencode mcp list` showed the server as `connected`.
- **opencode, project:** the entry was written, and uninstall left no file behind when the install had created it.
- **Antigravity, global:** `HOME` and `USERPROFILE` pointed at a temporary home. `agy mcp list` showed the server as `enabled`, and the skill was copied to `~/.gemini/config/skills`.
- **Claude Code, project and local:** a temporary folder. The plugin was enabled in that folder, its entries went into the right settings file, and uninstall removed them.
- **Tool descriptions:** a client connected over stdio and read `tools/list`. The descriptions showed the per-operation rules, and the `account` argument said that changes need one name.
- **The published package:** installed from npm into a temporary folder, its `serve` command answered `tools/list` with ten tools, nine of them with the `account` argument.

Live checks that remain open:

- the browser login (`add <name>`) with a real Netlify account;
- a global install on a real Claude Code, Codex, opencode or Antigravity setup;
- the interactive questions in a real terminal;
- a live model run that shows an agent loading the Codex or Antigravity skill.

## Writing new tests

- Use `node:test` and `node:assert/strict`. Put the file in `src/test/` with the `.test.ts` suffix.
- Use a fresh temporary folder, and set `MULTI_ACCOUNT_NETLIFY_HOME` for it, when a test writes state.
- Pass a fake runner for any command, so no real agent is started. The real runner is in `src/agents/command.ts`.
- With `it(name, options, fn)`, the options come before the function.
- Keep expected objects in the same shape as the real ones. `deepStrictEqual` treats a missing key and a key set to `undefined` as different.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- a matrix of **Windows** and **Ubuntu**, on Node 22;
- `npm ci`, then `npm run typecheck`, then `npm test`.

`.github/workflows/npm.yml` runs the same tests on Windows before it publishes. See [RELEASING.md](RELEASING.md).

Ubuntu passes the suite. The live checks above were run on Windows only.
