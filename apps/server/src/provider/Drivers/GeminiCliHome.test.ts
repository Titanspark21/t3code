import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  makeGeminiCliEnvironment,
  makeGeminiContinuationGroupKey,
  resolveGeminiProfileDir,
} from "./GeminiCliHome.ts";

it.layer(NodeServices.layer)("GeminiCliHome", (it) => {
  describe("Antigravity profile isolation", () => {
    it.effect("maps a profile directory to HOME and USERPROFILE", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir(), ".gemini-1");
        const config = { antigravity: true, configDir: "~/.gemini-1" } as const;
        const environment = yield* makeGeminiCliEnvironment(config, { PATH: "test-path" });

        expect(yield* resolveGeminiProfileDir(config)).toBe(resolved);
        expect(environment).toEqual({
          PATH: "test-path",
          HOME: resolved,
          USERPROFILE: resolved,
        });
        expect(yield* makeGeminiContinuationGroupKey(config)).toBe(
          `antigravity:profile:${resolved}`,
        );
      }),
    );

    it.effect("keeps official Gemini CLI compatibility behind the flavor switch", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir(), ".gemini-official");
        const config = { antigravity: false, configDir: "~/.gemini-official" } as const;

        expect(yield* makeGeminiCliEnvironment(config, {})).toEqual({ GEMINI_HOME: resolved });
        expect(yield* makeGeminiContinuationGroupKey(config)).toBe(`gemini:profile:${resolved}`);
      }),
    );
  });
});
