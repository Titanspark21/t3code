import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  resolveClaudeConfigDir,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("uses the process home when no Claude home override is configured", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir());

        expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolved);
        expect(yield* makeClaudeEnvironment({ homePath: "", configDir: "" })).toBe(process.env);
      }),
    );

    it.effect("resolves configured Claude HOME and stamps continuation/cache keys with it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath, configDir: "" })).HOME).toBe(resolved);
        expect(yield* makeClaudeContinuationGroupKey({ homePath, configDir: "" })).toBe(
          `claude:home:${resolved}`,
        );
        expect(
          yield* makeClaudeCapabilitiesCacheKey({
            binaryPath: "claude",
            homePath,
            configDir: "",
          }),
        ).toBe(`claude\0claude:home:${resolved}`);
      }),
    );

    it.effect("isolates direct CLAUDE_CONFIG_DIR profiles", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const configDir = "~/.claude-1";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-1");
        const environment = yield* makeClaudeEnvironment(
          { homePath: "", configDir },
          { PATH: "test-path" },
        );

        expect(yield* resolveClaudeConfigDir({ configDir })).toBe(resolved);
        expect(environment).toMatchObject({
          PATH: "test-path",
          CLAUDE_CONFIG_DIR: resolved,
        });
        expect(environment.HOME).toBeUndefined();
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "", configDir })).toBe(
          `claude:config:${resolved}`,
        );
      }),
    );

    it.effect("keeps continuation compatible across instances with the same Claude HOME", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir());

        expect(yield* makeClaudeContinuationGroupKey({ homePath: "", configDir: "" })).toBe(
          `claude:home:${resolved}`,
        );
      }),
    );
  });
});
