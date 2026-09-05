#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - This host-side release bridge invokes the GitHub CLI directly.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

interface ReleaseAsset {
  readonly name: string;
  readonly size: number;
}

interface GitHubRelease {
  readonly assets: ReadonlyArray<ReleaseAsset>;
  readonly url: string;
}

const printUsage = (): void => {
  console.log(`Usage:
  vp run release:desktop:publish -- --tag vX.Y.Z --artifact-dir release/my-build

The tag must already exist on origin. The artifact directory must contain:
  - one Linux .AppImage
  - one Windows .exe
  - one Windows .exe.blockmap
  - latest.yml and latest-linux.yml (or nightly.yml and nightly-linux.yml)

The command uploads the assets to GitHub and verifies their remote names and sizes.`);
};

const run = (command: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.execFileSync(command, [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const tryRun = (command: string, args: ReadonlyArray<string>): string | undefined => {
  try {
    return run(command, args);
  } catch {
    return undefined;
  }
};

const optionValue = (args: ReadonlyArray<string>, name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
};

const resolveRepository = (): string => {
  const remote = tryRun("git", ["remote", "get-url", "origin"]);
  const match = remote?.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match?.[1] || !match[2]) {
    throw new Error("Could not resolve a GitHub owner/repository from the origin remote.");
  }
  return `${match[1]}/${match[2]}`;
};

const resolveTag = (requestedTag: string | undefined): string => {
  const tag = requestedTag ?? tryRun("git", ["describe", "--tags", "--exact-match", "HEAD"]);
  if (!tag) {
    throw new Error("No tag was supplied and HEAD is not exactly at a tag. Pass --tag vX.Y.Z.");
  }
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(
      `Unsupported release tag '${tag}'. Use a vX.Y.Z tag, optionally with a suffix.`,
    );
  }

  const remoteTag = tryRun("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (!remoteTag) {
    throw new Error(`Tag '${tag}' is not pushed to origin. Push it before publishing installers.`);
  }
  return tag;
};

const collectAssets = (requestedDirectory: string, tag: string): ReadonlyArray<string> => {
  const directory = NodePath.resolve(repoRoot, requestedDirectory);
  if (!NodeFS.existsSync(directory) || !NodeFS.statSync(directory).isDirectory()) {
    throw new Error(`Artifact directory does not exist: ${requestedDirectory}`);
  }

  const names = NodeFS.readdirSync(directory).filter((name) =>
    /(?:\.AppImage|\.exe|\.blockmap|^(?:latest|nightly).*\.yml)$/i.test(name),
  );
  if (!names.some((name) => name.endsWith(".AppImage"))) {
    throw new Error(`No Linux AppImage found in ${requestedDirectory}.`);
  }
  if (!names.some((name) => name.endsWith(".exe") && !name.endsWith(".blockmap"))) {
    throw new Error(`No Windows installer found in ${requestedDirectory}.`);
  }
  if (!names.some((name) => name.endsWith(".exe.blockmap"))) {
    throw new Error(`No Windows blockmap found in ${requestedDirectory}.`);
  }
  const metadataNames = tag.includes("-nightly.")
    ? ["nightly.yml", "nightly-linux.yml"]
    : ["latest.yml", "latest-linux.yml"];
  for (const metadataName of metadataNames) {
    if (!names.includes(metadataName)) {
      throw new Error(
        `Missing required updater metadata ${metadataName} in ${requestedDirectory}.`,
      );
    }
  }

  const assets = names
    .map((name) => NodePath.join(directory, name))
    .filter((assetPath) => NodeFS.statSync(assetPath).isFile())
    .filter((assetPath) => NodeFS.statSync(assetPath).size > 0);
  if (assets.length === 0)
    throw new Error(`No non-empty release assets found in ${requestedDirectory}.`);
  return assets;
};

const readRelease = (repository: string, tag: string): GitHubRelease | undefined => {
  const output = tryRun("gh", [
    "release",
    "view",
    tag,
    "--repo",
    repository,
    "--json",
    "url,assets",
  ]);
  return output ? (JSON.parse(output) as GitHubRelease) : undefined;
};

const main = (): void => {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const artifactDirectory = optionValue(args, "--artifact-dir");
  if (!artifactDirectory)
    throw new Error("Pass --artifact-dir with the directory containing the installers.");

  run("gh", ["auth", "status", "--hostname", "github.com"]);
  const repository = resolveRepository();
  const tag = resolveTag(optionValue(args, "--tag"));
  const assets = collectAssets(artifactDirectory, tag);
  const assetNames = assets.map((assetPath) => NodePath.basename(assetPath));
  const existingRelease = readRelease(repository, tag);

  if (existingRelease) {
    run("gh", ["release", "upload", tag, ...assets, "--repo", repository, "--clobber"]);
  } else {
    const releaseArgs = [
      "release",
      "create",
      tag,
      ...assets,
      "--repo",
      repository,
      "--verify-tag",
      "--title",
      `T3 Code ${tag}`,
      "--notes",
      `Desktop installers for ${tag}.`,
    ];
    if (tag.includes("-")) releaseArgs.push("--prerelease");
    run("gh", releaseArgs);
  }

  const published = readRelease(repository, tag);
  if (!published) throw new Error(`GitHub Release ${tag} could not be read back after upload.`);

  const publishedAssets = new Map(published.assets.map((asset) => [asset.name, asset.size]));
  for (const assetPath of assets) {
    const name = NodePath.basename(assetPath);
    const localSize = NodeFS.statSync(assetPath).size;
    if (publishedAssets.get(name) !== localSize) {
      throw new Error(`GitHub asset verification failed for ${name}.`);
    }
  }

  console.log(`Published ${assetNames.join(", ")} to ${published.url}`);
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
