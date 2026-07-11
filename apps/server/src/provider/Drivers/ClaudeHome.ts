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
