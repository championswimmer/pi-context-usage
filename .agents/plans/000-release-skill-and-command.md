---
name: 000-release-skill-and-command
description: Add a packaged release skill and a /release command that bumps versions, tags releases, pushes to GitHub, and publishes to npm safely.
steps:
  - phase: discovery
    steps:
      - "- [x] step 1: inspect the repo structure, package metadata, and publish workflow"
      - "- [x] step 2: read pi docs for skills, extensions, commands, and package resources"
      - "- [x] step 3: decide how the release skill and /release command should work together"
  - phase: implementation
    steps:
      - "- [x] step 1: add a packaged release skill with release workflow instructions and safeguards"
      - "- [x] step 2: implement a /release command with argument completion, preflight checks, version bumping, git push, tagging, and npm publish"
      - "- [x] step 3: update package metadata and docs so the skill ships with the package"
      - "- [x] step 4: make the publish workflow tolerant of already-published versions"
  - phase: validation
    steps:
      - "- [x] step 1: run repo tests or smoke checks"
      - "- [x] step 2: review changed files and summarize how to use the new release flow"
---

# 000-release-skill-and-command

## Phase 1 — Discovery
- [x] step 1: inspect the repo structure, package metadata, and publish workflow
- [x] step 2: read pi docs for skills, extensions, commands, and package resources
- [x] step 3: decide how the release skill and /release command should work together

## Phase 2 — Implementation
- [x] step 1: add a packaged release skill with release workflow instructions and safeguards
- [x] step 2: implement a /release command with argument completion, preflight checks, version bumping, git push, tagging, and npm publish
- [x] step 3: update package metadata and docs so the skill ships with the package
- [x] step 4: make the publish workflow tolerant of already-published versions

## Phase 3 — Validation
- [x] step 1: run repo tests or smoke checks
- [x] step 2: review changed files and summarize how to use the new release flow
