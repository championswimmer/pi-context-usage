---
name: release
description: Cut a new release for this repository. Use when asked to bump a major, minor, or patch version, publish to npm, create or push a git tag, or walk through the repo's release process. Prefer the built-in /release major|minor|patch command in this repo.
compatibility: Requires a clean git working tree, git push access to the repository, and npm publish access for the package.
---

# Release

Use this skill when the user wants to publish a new version of this package.

## Preferred workflow

In this repository, prefer the automated slash command:

```text
/release major
/release minor
/release patch
```

The `/release` extension command is the canonical release flow for this repo.
It performs the release instead of asking the model to manually stitch together shell commands.

## What `/release` does

The command performs this workflow:

1. Validates the argument is `major`, `minor`, or `patch`
2. Waits for the agent to become idle
3. Reads `package.json` to determine the current package name and version
4. Verifies the git working tree is clean
5. Detects the current branch and git remote
6. Verifies the release tag does not already exist locally or on the remote
7. Verifies npm authentication with `npm whoami`
8. Checks that the target version is not already published to npm
9. Runs the smoke test `npm run test:mock`
10. Prompts the user for confirmation
11. Runs `npm version <level> --no-git-tag-version`
12. Commits the version bump as `release: vX.Y.Z`
13. Runs `npm publish --access public`
14. Creates a git tag `vX.Y.Z`
15. Pushes the branch to the configured remote
16. Pushes the tag to GitHub

## Repository-specific details

- Package name: `pi-context-usage`
- Version source: `package.json`
- Lockfile updated: `package-lock.json`
- Tag format: `vX.Y.Z`
- Publish workflow: `.github/workflows/publish.yml`
- Smoke test: `npm run test:mock`

The GitHub Actions publish workflow is intentionally tolerant of duplicate publishes.
If `/release` already published the version to npm, the tag-triggered workflow should skip the duplicate publish instead of failing.

## When to use the command

Use `/release <level>` when the user asks any of the following:

- make a release
- publish a new version
- cut a patch release
- bump minor or major version
- tag and publish to npm

If the user only wants to inspect or explain the process, describe it instead of running it.

## Safety rules

Before releasing, make sure these conditions hold:

- The working tree is clean
- The user intends to publish publicly
- npm credentials are available
- The next version does not already exist on npm
- The git tag does not already exist

If any preflight check fails, stop and show the error instead of forcing the release.

## How to respond

- If the user explicitly asks to perform a release, use `/release major`, `/release minor`, or `/release patch`.
- If the user is unsure which bump level to use, explain the difference first:
  - `patch`: backwards-compatible bugfix release
  - `minor`: backwards-compatible feature release
  - `major`: breaking changes
- After a successful release, summarize the new version, branch push, and tag push.
- If the release fails after mutating the repo, tell the user to inspect `git status` before retrying.

## Manual fallback

If `/release` is unavailable for some reason, use this manual fallback carefully:

```bash
npm run test:mock
npm version <major|minor|patch> --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: vX.Y.Z"
npm publish --access public
git tag vX.Y.Z
git push origin <branch>
git push origin vX.Y.Z
```

Replace `X.Y.Z` with the bumped version and `<branch>` with the current branch.

## Notes for future maintenance

If the release workflow changes, keep these in sync:

- `src/index.ts` release command implementation
- `.github/workflows/publish.yml`
- `README.md`
- this skill file
