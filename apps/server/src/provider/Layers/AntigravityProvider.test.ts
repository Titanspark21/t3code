import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { AntigravitySettings } from "@t3tools/contracts/antigravity";

import { checkAntigravityProviderStatus } from "./AntigravityProvider.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

const makeFakeAntigravity = Effect.fn("makeFakeAntigravity")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-antigravity-provider-",
  });
  const binaryPath = path.join(directory, "agy");

  yield* fileSystem.writeFileString(
    binaryPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then printf "agy 1.1.7\\n"; exit 0; fi',
      'if [ "$1" = "models" ]; then printf "gemini-2.5-pro\\n"; exit 0; fi',
      "exit 1",
      "",
    ].join("\n"),
  );
  yield* fileSystem.chmod(binaryPath, 0o755);
  return binaryPath;
});

it.layer(NodeServices.layer)("checkAntigravityProviderStatus", (it) => {
  it.effect("attaches the verified command catalogue to a healthy snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const binaryPath = yield* makeFakeAntigravity();
        const snapshot = yield* checkAntigravityProviderStatus(
          decodeAntigravitySettings({
            enabled: true,
            binaryPath,
            bridgeCommand: "agy-acp-bridge",
          }),
        );

        expect(snapshot.status).toBe("ready");
        expect(snapshot.version).toBe("1.1.7");
        expect(snapshot.models.map((model) => model.slug)).toEqual(["gemini-2.5-pro"]);
        expect(snapshot.slashCommands.map((command) => command.name)).toEqual([
          "help",
          "config",
          "settings",
          "model",
          "planning",
          "mcp",
          "quit",
        ]);
        expect(snapshot.slashCommands.every((command) => command.support === "supported")).toBe(
          true,
        );
      }),
    ),
  );

  it.effect("uses the bundled bridge when no override is configured", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const binaryPath = yield* makeFakeAntigravity();
        const snapshot = yield* checkAntigravityProviderStatus(
          decodeAntigravitySettings({ enabled: true, binaryPath }),
        );

        expect(snapshot.status).toBe("ready");
        expect(snapshot.auth.status).toBe("authenticated");
        expect(snapshot.slashCommands).not.toHaveLength(0);
      }),
    ),
  );
});
