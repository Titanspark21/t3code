/**
 * Health and model-catalogue probe for the Antigravity (`agy`) provider.
 *
 * Two things distinguish this from the other providers' probes:
 *
 * 1. **The model catalogue comes from the CLI**, via `agy models`, not from a
 *    built-in list. `agy` moves fast and is closed-source; a hardcoded
 *    catalogue rots silently, and a picker offering models the CLI no longer
 *    accepts is worse than a short one.
 *
 * 2. **An unconfigured ACP bridge is a first-class state.** `agy` has no native
 *    ACP mode yet (google-antigravity/antigravity-cli#31), so this driver needs
 *    a bridge process. A missing bridge produces an actionable message here
 *    rather than an opaque spawn failure at the first turn.
 *
 * @module provider/Layers/AntigravityProvider
 */
import type { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import type { AntigravitySettings } from "@t3tools/contracts/antigravity";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  detailFromResult,
  isCommandMissingCause,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  antigravityModelDisplayName,
  parseAntigravityModels,
} from "../Drivers/AntigravityLaunch.ts";
import { makeAntigravityEnvironment } from "../Drivers/AntigravityHome.ts";

const ANTIGRAVITY_PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "agy",
  showInteractionModeToggle: true,
} as const;

const VERSION_PROBE_TIMEOUT_MS = 15_000;
const MODELS_PROBE_TIMEOUT_MS = 20_000;

const ANTIGRAVITY_DOCS_URL = "https://antigravity.google/docs/cli";

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

/**
 * Shown when no ACP bridge is configured. Names the reason and the fix, because
 * "Antigravity is unavailable" with no explanation is the failure mode this
 * driver is most likely to hit on a fresh install.
 */
export const ANTIGRAVITY_BRIDGE_MISSING_MESSAGE = [
  "No ACP bridge is configured for this Antigravity instance.",
  "The Antigravity CLI does not speak Agent Client Protocol natively yet, so T3 Code needs a bridge command to drive it.",
  "Set one in this provider's settings.",
].join(" ");

function resolveBinary(config: AntigravitySettings): string {
  return config.binaryPath.trim() || "agy";
}

const runAntigravityCommand = (
  config: AntigravitySettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const command = resolveBinary(config);
    const spawnCommand = yield* resolveSpawnCommand(command, [...args], { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

/**
 * Model list for this instance.
 *
 * Falls back to whatever the user configured as custom models when the CLI
 * cannot be asked — an empty picker with a clear provider error beats a picker
 * full of names that may no longer resolve.
 */
export const readAntigravityModels = Effect.fn("readAntigravityModels")(function* (
  config: AntigravitySettings,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<
  ReadonlyArray<ServerProviderModel>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const result = yield* runAntigravityCommand(config, ["models"], environment).pipe(
    Effect.timeoutOption(MODELS_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(result) || Option.isNone(result.success)) return [];

  const command = result.success.value;
  if (command.code !== 0) return [];

  return parseAntigravityModels(command.stdout).map(
    (model): ServerProviderModel => ({
      slug: model.slug,
      name: model.name || antigravityModelDisplayName(model.slug),
      isCustom: false,
      capabilities: EMPTY_CAPABILITIES,
    }),
  );
});

export const checkAntigravityProviderStatus = Effect.fn("checkAntigravityProviderStatus")(
  function* (
    config: AntigravitySettings,
    baseEnvironment: NodeJS.ProcessEnv = process.env,
  ): Effect.fn.Return<
    ServerProviderDraft,
    never,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
  > {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    // Probes run under the same isolated environment as real sessions, so a
    // profile that is not logged in reports as unauthenticated here rather than
    // inheriting the default account's health and looking fine until first use.
    const environment = makeAntigravityEnvironment(config, baseEnvironment);

    const fallbackModels = providerModelsFromSettings([], config.customModels, EMPTY_CAPABILITIES);

    if (!config.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in T3 Code settings.",
        },
      });
    }

    const versionResult = yield* runAntigravityCommand(config, ["--version"], environment).pipe(
      Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(versionResult)) {
      const error = versionResult.failure;
      const missing = isCommandMissingCause(error);
      yield* Effect.logWarning("Antigravity CLI health check failed.", {
        errorTag: error._tag,
      });
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: config.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: !missing,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: missing
            ? `Antigravity CLI (\`${resolveBinary(config)}\`) is not installed or not on PATH. See ${ANTIGRAVITY_DOCS_URL}.`
            : "Failed to execute the Antigravity CLI health check.",
        },
      });
    }

    if (Option.isNone(versionResult.success)) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: config.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Antigravity CLI is installed but timed out while reporting its version.",
        },
      });
    }

    const version = versionResult.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: config.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: detail
            ? `Antigravity CLI is installed but failed to run. ${detail}`
            : "Antigravity CLI is installed but failed to run.",
        },
      });
    }

    const discovered = yield* readAntigravityModels(config, environment);
    const models =
      discovered.length > 0
        ? providerModelsFromSettings(discovered, config.customModels, EMPTY_CAPABILITIES)
        : fallbackModels;

    // The CLI works but we still cannot drive it without a bridge. Report that
    // as a warning with the fix rather than as healthy — a green provider that
    // fails on the first turn is the worse outcome.
    if (config.bridgeCommand.trim().length === 0) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: config.enabled,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: version.stdout.trim() || null,
          status: "warning",
          auth: { status: "unknown" },
          message: ANTIGRAVITY_BRIDGE_MISSING_MESSAGE,
        },
      });
    }

    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: config.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: version.stdout.trim() || null,
        status: "ready",
        auth: { status: "authenticated", type: "antigravity", label: "Antigravity CLI" },
      },
    });
  },
);
