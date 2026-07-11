import * as NodeOS from "node:os";

import type { GeminiCliSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";

type GeminiProfileSettings = Pick<GeminiCliSettings, "antigravity" | "configDir">;

export const resolveGeminiProfileDir = Effect.fn("resolveGeminiProfileDir")(function* (
  config: GeminiProfileSettings,
): Effect.fn.Return<string | undefined, never, Path.Path> {
  const path = yield* Path.Path;
  const configDir = config.configDir.trim();
  return configDir.length > 0 ? path.resolve(expandHomePath(configDir)) : undefined;
});

export const makeGeminiCliEnvironment = Effect.fn("makeGeminiCliEnvironment")(function* (
  config: GeminiProfileSettings,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const profileDir = yield* resolveGeminiProfileDir(config);
  if (!profileDir) return baseEnv;

  return config.antigravity
    ? {
        ...baseEnv,
        HOME: profileDir,
        USERPROFILE: profileDir,
      }
    : {
        ...baseEnv,
        GEMINI_HOME: profileDir,
      };
});

export const makeGeminiContinuationGroupKey = Effect.fn("makeGeminiContinuationGroupKey")(
  function* (config: GeminiProfileSettings): Effect.fn.Return<string, never, Path.Path> {
    const profileDir = (yield* resolveGeminiProfileDir(config)) ?? NodeOS.homedir();
    return `${config.antigravity ? "antigravity" : "gemini"}:profile:${profileDir}`;
  },
);
