---
name: release
description: Cut a new release for this repository. Use when asked to bump a major, minor, or patch version, publish to npm, create or push a git tag, or walk through the repo's release process.
compatibility: Requires a clean git working tree, git push access to the repository, and npm Trusted Publishing configured for this package/workflow.
---

# Release

Use this private repository-maintainer skill when the user wants to publish a new version of this package. The published extension deliberately exposes no `/release` command.

## Release workflow

1. Confirm the requested release type is `major`, `minor`, or `patch`.
2. Confirm the user intends a public npm release.
3. Verify the working tree is clean and identify the current branch and its remote.
4. Run `npm run test:mock`.
5. Bump the version without creating an automatic commit or tag.
6. Verify that the target npm version and `vX.Y.Z` tag do not already exist.
7. Commit the lockfile and manifest, create the tag, then push the branch and tag.
8. GitHub Actions publishes through npm Trusted Publishing.

Run the following commands from the repository root, replacing `<level>` with `major`, `minor`, or `patch`:

```bash
git status --short
git branch --show-current
git remote get-url origin
npm run test:mock
npm version <level> --no-git-tag-version
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
npm view "pi-context-usage@$VERSION" version
git ls-remote --exit-code --tags origin "$TAG"
git add package.json package-lock.json
git commit -m "release: $TAG"
git tag "$TAG"
git push origin "$(git branch --show-current)"
git push origin "$TAG"
```

## Required preflight handling

- Stop if `git status --short` prints anything.
- Treat a successful `npm view` as evidence that the version is already published; do not proceed.
- Treat a successful `git ls-remote --exit-code --tags` as evidence that the tag already exists; do not proceed.
- `npm view` and `git ls-remote` intentionally exit non-zero when their target is absent. Check those results before continuing; do not blindly chain this exact block with `set -e`.
- Before committing, confirm `package.json` and `package-lock.json` contain the intended version and review `git diff --check`.
- If a command fails after `npm version`, stop and report `git status`; do not retry blindly.

## Repository-specific details

- Package name: `pi-context-usage`
- Version source: `package.json`
- Lockfile: `package-lock.json`
- Tag format: `vX.Y.Z`
- Publish workflow: `.github/workflows/publish.yml`
- Smoke test: `npm run test:mock`
- npm publication uses OIDC Trusted Publishing.

## Version guidance

- `patch`: backwards-compatible bugfix
- `minor`: backwards-compatible feature
- `major`: breaking change

After a successful release, report the version, pushed branch, and pushed tag.
