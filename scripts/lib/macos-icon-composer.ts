// @effect-diagnostics nodeBuiltinImport:off - Standalone icon asset compiler shells out to actool and reads generated files.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export interface CompiledMacIconAsset {
  readonly assetCatalog: Buffer;
  readonly icnsFile: Buffer;
}

function parseActoolVersion(rawOutput: string): string | null {
  const match = rawOutput.match(/<key>short-bundle-version<\/key>\s*<string>([^<]+)<\/string>/);
  return match?.[1] ?? null;
}

function assertSupportedActoolVersion(): void {
  const result = NodeChildProcess.spawnSync("actool", ["--version"], {
    encoding: "utf8",
  });
  const version = parseActoolVersion(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  const major = Number(version?.split(".")[0] ?? Number.NaN);

  if (result.status !== 0 || !version || !Number.isFinite(major)) {
    throw new Error(
      "Failed to read actool version. Install Xcode 26 or newer to enable macOS appearance-aware icons.",
    );
  }

  if (major < 26) {
    throw new Error(
      `Unsupported actool version ${version}. Install Xcode 26 or newer to enable macOS appearance-aware icons.`,
    );
  }
}

export async function generateAssetCatalogForIcon(
  inputPath: string,
): Promise<CompiledMacIconAsset> {
  assertSupportedActoolVersion();

  const tempRoot = await NodeFSP.mkdtemp(
    NodePath.resolve(NodeOS.tmpdir(), "t3code-icon-composer-"),
  );
  const iconPath = NodePath.resolve(tempRoot, "Icon.icon");
  const outputPath = NodePath.resolve(tempRoot, "out");

  try {
    await NodeFSP.cp(inputPath, iconPath, { recursive: true });
    await NodeFSP.mkdir(outputPath, { recursive: true });

    const result = NodeChildProcess.spawnSync(
      "actool",
      [
        iconPath,
        "--compile",
        outputPath,
        "--output-format",
        "human-readable-text",
        "--notices",
        "--warnings",
        "--output-partial-info-plist",
        NodePath.resolve(outputPath, "assetcatalog_generated_info.plist"),
        "--app-icon",
        "Icon",
        "--include-all-app-icons",
        "--accent-color",
        "AccentColor",
        "--enable-on-demand-resources",
        "NO",
        "--development-region",
        "en",
        "--target-device",
        "mac",
        "--minimum-deployment-target",
        "26.0",
        "--platform",
        "macosx",
      ],
      {
        encoding: "utf8",
      },
    );

    if (result.status !== 0) {
      throw new Error(
        `actool failed while compiling '${inputPath}': ${(result.stderr || result.stdout || "").trim()}`,
      );
    }

    return {
      assetCatalog: await NodeFSP.readFile(NodePath.resolve(outputPath, "Assets.car")),
      icnsFile: await NodeFSP.readFile(NodePath.resolve(outputPath, "Icon.icns")),
    };
  } finally {
    await NodeFSP.rm(tempRoot, { recursive: true, force: true });
  }
}
