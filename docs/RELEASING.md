# Releasing

How a change reaches npm. Releases happen only when the maintainer asks for one.

## The four version numbers

A release changes the version in four places, and they must all match:

| File | Field |
|---|---|
| `package.json` | `version` (and `package-lock.json`, see below) |
| `plugins/multi-account-netlify/.claude-plugin/plugin.json` | `version` |
| `.claude-plugin/marketplace.json` | `metadata.version` |
| the git tag | `vX.Y.Z` |

The tests check the first three. The release workflow checks the tag against `package.json`.

## Steps

1. **Bump the versions.**

   ```sh
   npm version X.Y.Z --no-git-tag-version
   ```

   This updates `package.json` and `package-lock.json`. Then set the same version in `plugins/multi-account-netlify/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.

2. **Update the docs in the same change.** Add the version to `CHANGELOG.md`, and check [README.md](../README.md) and the other docs against what the release contains.

3. **Test, then check for secrets and personal data.**

   ```sh
   npm test
   npm pack --dry-run
   ```

   The repository is public, so check before every push. Put your own values in your shell, not in this file. `SCAN_PATTERNS` holds your email address, your home folder paths, and any token you have used here.

   ```sh
   git log --format='%an <%ae>' | sort -u
   git grep -n -I -E "$SCAN_PATTERNS|nfp_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|BEGIN [A-Z ]*PRIVATE KEY" -- . ':!package-lock.json'
   ```

   The first command must show only the GitHub no-reply address for the owner. The second must print nothing. The token patterns need 30 or more characters, so short fake tokens in tests do not match. Any match is a reason to stop and look before you push.

4. **Commit with `[skip ci]` in the message.** The release workflow runs the same tests before it publishes. Without `[skip ci]`, a push to `main` starts the publish workflow as well, and two runs would try to publish the same version.

   ```sh
   git add -A
   git commit -m "Release X.Y.Z [skip ci]"
   git push origin main
   ```

5. **Create the GitHub release on `main`.** The release is what starts the publish.

   ```sh
   gh release create vX.Y.Z --repo FiredMosquito831/multi-account-netlify-mcp --target main --title "vX.Y.Z" --notes-file <notes.md>
   ```

   Publish the release. Do not leave it as a draft, because a draft does not start the workflow.

6. **Watch the workflow.** The `npm` workflow runs on the release event. It runs the tests on Windows, then, if they pass, the publish job on Ubuntu. The publish job checks that the tag equals the version in `package.json`, then publishes with `npm publish --provenance --access public`.

7. **Check the result yourself.** A green run is not proof that the package is out.

   ```sh
   npm view multi-account-netlify-mcp version dist-tags.latest --prefer-online
   npm view multi-account-netlify-mcp@X.Y.Z dist.attestations.provenance.predicateType gitHead --prefer-online
   ```

   The registry can take a few minutes to show a new version. The provenance type should be `https://slsa.dev/provenance/v1`, and `gitHead` should be the release commit.

8. **Install the new version from the registry** into a temporary folder, and run `help` and `doctor` from it. Use a throwaway data folder, through `MULTI_ACCOUNT_NETLIFY_HOME`.

## How the publish works

- **Trusted publishing.** npm trusts GitHub Actions for this package, through OIDC. There is no npm token in the repository or in GitHub's secrets. The trusted publisher is set on npmjs.com: owner `FiredMosquito831`, repository `multi-account-netlify-mcp`, workflow file `npm.yml`, environment empty. If that setting changes, the publish job fails with an authentication error.
- **Provenance.** `--provenance` attaches a signed statement that links the package to the commit it was built from.
- **Repeat runs are safe.** If the version is already on npm, the publish job does nothing and says so.
- **Triggers.** The `npm` workflow also runs on a push to `main` that changes the package. It publishes only when the version is new. A push that changes the code but not the version publishes nothing.
- **Manual runs.** Actions, then `npm`, then Run workflow, with a `tag` such as `vX.Y.Z`. Use this to retry a publish for an existing tag.
- **Pinned actions.** The workflows pin `actions/checkout` and `actions/setup-node` to commit SHAs, with the tag in a comment. To update one, resolve the new tag with `gh api repos/actions/checkout/commits/v7 --jq .sha` (or the other action and tag), then change the SHA and the comment together.

## When something goes wrong

- **The tests fail in the workflow.** Nothing is published. Fix the cause, then make a new commit and a new release. Do not move the tag.
- **The tag does not match `package.json`.** The publish job stops with an error. Fix the version or the tag. Do not publish a version that does not match its tag.
- **The version is already on npm.** Bump the version and release again. npm does not allow the same version twice, even after unpublishing.
- **A published version is bad.** Publish a fix as the next version, then deprecate the bad one: `npm deprecate multi-account-netlify-mcp@X.Y.Z "reason"`. Check npm's current unpublish rules before you rely on unpublishing.
- **The trusted publisher is missing.** The publish job fails with an authentication error. Add the trusted publisher on npmjs.com, then run the workflow again with the manual trigger.

## Release history

See [CHANGELOG.md](../CHANGELOG.md).
