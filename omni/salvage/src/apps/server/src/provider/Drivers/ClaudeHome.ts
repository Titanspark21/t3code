import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  return path.resolve(homePath.length > 0 ? expandHomePath(homePath) : NodeOS.homedir());
});

/**
 * Resolve the Claude Agent SDK's `pathToClaudeCodeExecutable`, or `undefined` to
 * use the SDK's own bundled native binary.
 *
 * The SDK requires a NATIVE Claude Code binary. The default `binaryPath`
 * ("claude") resolves on many machines to the npm CLI shim
 * (`claude.ps1`/`claude.cmd`), which the SDK rejects with "native binary not
 * found" — that breaks the auth-status probe (and sessions) for every account,
 * showing "Could not verify Claude authentication status". Returning `undefined`
 * for the default makes the SDK fall back to its bundled native binary, which
 * still honours the per-instance `CLAUDE_CONFIG_DIR`. Only an explicit custom
 * path (something other than the bare default) is passed through.
 */
export function resolveClaudeExecutablePath(binaryPath: string): string | undefined {
  const trimmed = binaryPath.trim();
  if (trimmed.length === 0 || trimmed === "claude") return undefined;
  return trimmed;
}

export const resolveClaudeConfigDir = Effect.fn("resolveClaudeConfigDir")(function* (
  config: Pick<ClaudeSettings, "configDir">,
): Effect.fn.Return<string | undefined, never, Path.Path> {
  const path = yield* Path.Path;
  const configDir = config.configDir.trim();
  return configDir.length > 0 ? path.resolve(expandHomePath(configDir)) : undefined;
});

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath" | "configDir">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  const resolvedConfigDir = yield* resolveClaudeConfigDir(config);
  if (homePath.length === 0 && resolvedConfigDir === undefined) return resolvedBaseEnv;
  const resolvedHomePath = homePath.length > 0 ? yield* resolveClaudeHomePath(config) : undefined;
  return {
    ...resolvedBaseEnv,
    ...(resolvedHomePath ? { HOME: resolvedHomePath } : {}),
    ...(resolvedConfigDir ? { CLAUDE_CONFIG_DIR: resolvedConfigDir } : {}),
  };
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (
    config: Pick<ClaudeSettings, "homePath" | "configDir">,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedConfigDir = yield* resolveClaudeConfigDir(config);
    if (resolvedConfigDir) {
      return `claude:config:${resolvedConfigDir}`;
    }
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    return `claude:home:${resolvedHomePath}`;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "homePath" | "configDir">,
  ): Effect.fn.Return<string, never, Path.Path> {
    const continuationKey = yield* makeClaudeContinuationGroupKey(config);
    return `${config.binaryPath}\0${continuationKey}`;
  },
);
