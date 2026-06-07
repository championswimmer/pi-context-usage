import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const RELEASE_TYPES = ["major", "minor", "patch"] as const;
type ReleaseType = (typeof RELEASE_TYPES)[number];

type PackageInfo = {
  name: string;
  version: string;
};

class CommandFailure extends Error {
  constructor(
    readonly command: string,
    readonly args: string[],
    readonly result: ExecResult
  ) {
    super(formatExecFailure(command, args, result));
    this.name = "CommandFailure";
  }
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/^[a-zA-Z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

function summarizeExecResult(result: ExecResult): string {
  return (result.stderr || result.stdout || `exit code ${result.code}`).trim();
}

function formatExecFailure(
  command: string,
  args: string[],
  result: ExecResult
): string {
  const summary = summarizeExecResult(result);
  return `${formatCommand(command, args)} failed (${result.code})${summary ? `\n${summary}` : ""}`;
}

async function exec(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  options: ExecOptions = {}
): Promise<ExecResult> {
  const result = await pi.exec(command, args, options);
  if (result.code !== 0) {
    throw new CommandFailure(command, args, result);
  }
  return result;
}

async function execAllowFailure(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  options: ExecOptions = {}
): Promise<ExecResult> {
  return pi.exec(command, args, options);
}

function parseReleaseType(args: string): ReleaseType | null {
  const value = args.trim().toLowerCase();
  return RELEASE_TYPES.includes(value as ReleaseType)
    ? (value as ReleaseType)
    : null;
}

function getReleaseCompletions(prefix: string): AutocompleteItem[] | null {
  const normalized = prefix.trim().toLowerCase();
  const items = RELEASE_TYPES.filter((value) => value.startsWith(normalized)).map(
    (value) => ({ value, label: value })
  );
  return items.length > 0 ? items : null;
}

function bumpVersion(version: string, releaseType: ReleaseType): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(
      `Cannot calculate the next version from ${version}. Expected a simple semver version like 1.2.3.`
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  switch (releaseType) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

async function getPackageInfo(pi: ExtensionAPI, cwd: string): Promise<PackageInfo> {
  const result = await exec(
    pi,
    "node",
    [
      "-e",
      "const pkg = require('./package.json'); console.log(JSON.stringify({ name: pkg.name, version: pkg.version }));",
    ],
    { cwd, timeout: 10_000 }
  );

  return JSON.parse(result.stdout) as PackageInfo;
}

async function getCurrentBranch(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await exec(pi, "git", ["branch", "--show-current"], {
    cwd,
    timeout: 10_000,
  });
  const branch = result.stdout.trim();
  if (!branch) {
    throw new Error("Release command requires a checked-out branch.");
  }
  return branch;
}

async function getRemoteForBranch(
  pi: ExtensionAPI,
  cwd: string,
  branch: string
): Promise<{ remote: string; remoteUrl: string }> {
  const remoteResult = await execAllowFailure(
    pi,
    "git",
    ["config", "--get", `branch.${branch}.remote`],
    { cwd, timeout: 10_000 }
  );
  const remote = remoteResult.stdout.trim() || "origin";

  const remoteUrlResult = await exec(pi, "git", ["remote", "get-url", remote], {
    cwd,
    timeout: 10_000,
  });

  return {
    remote,
    remoteUrl: remoteUrlResult.stdout.trim(),
  };
}

async function assertCleanWorkingTree(pi: ExtensionAPI, cwd: string): Promise<void> {
  const result = await exec(pi, "git", ["status", "--porcelain"], {
    cwd,
    timeout: 10_000,
  });

  if (result.stdout.trim()) {
    throw new Error(
      "Refusing to release with a dirty working tree. Commit or stash your changes first."
    );
  }
}

async function assertTagDoesNotExist(
  pi: ExtensionAPI,
  cwd: string,
  remote: string,
  tag: string
): Promise<void> {
  const localResult = await execAllowFailure(
    pi,
    "git",
    ["rev-parse", "-q", "--verify", `refs/tags/${tag}`],
    { cwd, timeout: 10_000 }
  );

  if (localResult.code === 0) {
    throw new Error(`Tag ${tag} already exists locally.`);
  }

  const remoteResult = await execAllowFailure(
    pi,
    "git",
    ["ls-remote", "--tags", remote, tag],
    { cwd, timeout: 15_000 }
  );

  if (remoteResult.code === 0 && remoteResult.stdout.trim()) {
    throw new Error(`Tag ${tag} already exists on ${remote}.`);
  }
}

async function assertNpmAuth(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await exec(pi, "npm", ["whoami"], {
    cwd,
    timeout: 15_000,
  });
  return result.stdout.trim();
}

async function assertVersionNotPublished(
  pi: ExtensionAPI,
  cwd: string,
  packageName: string,
  version: string
): Promise<void> {
  const result = await execAllowFailure(
    pi,
    "npm",
    ["view", `${packageName}@${version}`, "version"],
    { cwd, timeout: 20_000 }
  );

  if (result.code === 0 && result.stdout.trim()) {
    throw new Error(`${packageName}@${version} is already published on npm.`);
  }
}

async function runReleaseSmokeTest(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<void> {
  ctx.ui.notify("Running release smoke test: npm run test:mock", "info");
  await exec(pi, "npm", ["run", "test:mock"], {
    cwd: ctx.cwd,
    timeout: 120_000,
  });
}

function releaseUsage(): string {
  return "Usage: /release <major|minor|patch>";
}

async function handleReleaseCommand(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext
): Promise<void> {
  const releaseType = parseReleaseType(args);
  if (!releaseType) {
    ctx.ui.notify(releaseUsage(), "warning");
    return;
  }

  await ctx.waitForIdle();

  let packageInfo = await getPackageInfo(pi, ctx.cwd);
  const nextVersion = bumpVersion(packageInfo.version, releaseType);
  const tag = `v${nextVersion}`;
  const branch = await getCurrentBranch(pi, ctx.cwd);
  const { remote, remoteUrl } = await getRemoteForBranch(pi, ctx.cwd, branch);

  try {
    ctx.ui.notify(
      `Preparing ${packageInfo.name} release ${packageInfo.version} → ${nextVersion} (${releaseType})`,
      "info"
    );

    await assertCleanWorkingTree(pi, ctx.cwd);
    await assertTagDoesNotExist(pi, ctx.cwd, remote, tag);

    const npmUser = await assertNpmAuth(pi, ctx.cwd);
    await assertVersionNotPublished(pi, ctx.cwd, packageInfo.name, nextVersion);
    await runReleaseSmokeTest(pi, ctx);

    const confirmationLines = [
      `${packageInfo.name}: ${packageInfo.version} → ${nextVersion}`,
      `Release type: ${releaseType}`,
      `Git branch: ${branch}`,
      `Git remote: ${remote} (${remoteUrl})`,
      `Git tag: ${tag}`,
      `npm account: ${npmUser}`,
      "",
      "This will bump package.json/package-lock.json, commit the change, publish to npm, push the branch, and push the tag.",
    ];

    if (ctx.hasUI) {
      const confirmed = await ctx.ui.confirm(
        "Confirm release",
        confirmationLines.join("\n")
      );
      if (!confirmed) {
        ctx.ui.notify("Release cancelled.", "warning");
        return;
      }
    }

    ctx.ui.notify(`Bumping version with npm version ${releaseType}`, "info");
    await exec(pi, "npm", ["version", releaseType, "--no-git-tag-version"], {
      cwd: ctx.cwd,
      timeout: 60_000,
    });

    packageInfo = await getPackageInfo(pi, ctx.cwd);

    ctx.ui.notify(`Creating release commit for v${packageInfo.version}`, "info");
    await exec(pi, "git", ["add", "package.json", "package-lock.json"], {
      cwd: ctx.cwd,
      timeout: 10_000,
    });
    await exec(pi, "git", ["commit", "-m", `release: v${packageInfo.version}`], {
      cwd: ctx.cwd,
      timeout: 60_000,
    });

    ctx.ui.notify(`Publishing ${packageInfo.name}@${packageInfo.version} to npm`, "info");
    await exec(pi, "npm", ["publish", "--access", "public"], {
      cwd: ctx.cwd,
      timeout: 300_000,
    });

    ctx.ui.notify(`Tagging release as ${tag}`, "info");
    await exec(pi, "git", ["tag", tag], {
      cwd: ctx.cwd,
      timeout: 10_000,
    });

    ctx.ui.notify(`Pushing ${branch} to ${remote}`, "info");
    await exec(pi, "git", ["push", remote, branch], {
      cwd: ctx.cwd,
      timeout: 300_000,
    });

    ctx.ui.notify(`Pushing tag ${tag} to ${remote}`, "info");
    await exec(pi, "git", ["push", remote, tag], {
      cwd: ctx.cwd,
      timeout: 300_000,
    });

    ctx.ui.notify(
      [
        `Release complete: ${packageInfo.name}@${packageInfo.version}`,
        `Branch pushed: ${remote}/${branch}`,
        `Tag pushed: ${tag}`,
        "GitHub Actions will see the tag push; if npm is already published, the workflow will skip the duplicate publish.",
      ].join("\n"),
      "info"
    );
  } catch (error) {
    const details =
      error instanceof CommandFailure
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    ctx.ui.notify(
      [
        "Release failed.",
        details,
        "",
        `Current package version on disk: ${(await getPackageInfo(pi, ctx.cwd)).version}`,
        "Check git status before retrying; the repo may already contain a bumped version or a release commit.",
      ].join("\n"),
      "error"
    );
  }
}

export function registerReleaseCommand(pi: ExtensionAPI) {
  pi.registerCommand("release", {
    description:
      "Bump package version, commit it, publish to npm, and push the git tag",
    getArgumentCompletions: getReleaseCompletions,
    handler: async (args, ctx) => {
      await handleReleaseCommand(pi, args, ctx);
    },
  });
}
