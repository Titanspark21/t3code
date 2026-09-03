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
 * 2. **The ACP bridge is bundled.** `agy` has no native ACP mode yet, so T3
 *    supplies a bridge process and still allows advanced users to override it.
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
import { withVerifiedSpawnCommand } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  detailFromResult,
  isCommandLaunchFailureCause,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  antigravityModelDisplayName,
  collapseAntigravityModelEfforts,
  parseAntigravityUsage,
  parseAntigravityModels,
} from "../Drivers/AntigravityLaunch.ts";
import { readAntigravityAccountEmail } from "../Drivers/AntigravityAccount.ts";
import {
  makeAntigravityEnvironment,
  resolveAntigravityDataHome,
} from "../Drivers/AntigravityHome.ts";
import { enrichAntigravitySlashCommands } from "./AntigravitySlashCommands.ts";

const ANTIGRAVITY_PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "agy",
  showInteractionModeToggle: true,
} as const;

const VERSION_PROBE_TIMEOUT_MS = 15_000;
const MODELS_PROBE_TIMEOUT_MS = 20_000;

const ANTIGRAVITY_DOCS_URL = "https://antigravity.google/docs/cli";

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

function resolveBinary(config: AntigravitySettings): string {
  return config.binaryPath.trim() || "agy";
}

const runAntigravityCommand = (
  config: AntigravitySettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
  promoteEnvironments: ReadonlyArray<NodeJS.ProcessEnv> = [environment],
) =>
  Effect.gen(function* () {
    const command = resolveBinary(config);
    return yield* withVerifiedSpawnCommand(
      command,
      args,
      { env: environment, promoteEnvironments },
      (candidate) =>
        spawnAndCollect(
          command,
          ChildProcess.make(candidate.command, candidate.args, {
            env: candidate.environment,
            shell: candidate.shell,
            // `agy models` is a non-interactive command, but the CLI keeps
            // reading stdin unless it receives EOF. Leaving the pipe open
            // makes the probe time out and discards an otherwise valid list.
            stdin: "ignore",
          }),
        ),
      isCommandLaunchFailureCause,
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

  return collapseAntigravityModelEfforts(parseAntigravityModels(command.stdout)).map(
    (model, index): ServerProviderModel => ({
      slug: model.slug,
      name: model.name || antigravityModelDisplayName(model.slug),
      subProvider: model.family === "google" ? "Google" : "Other models",
      isCustom: false,
      ...(index === 0 ? { isDefault: true } : {}),
      capabilities: createModelCapabilities({
        optionDescriptors:
          model.efforts.length === 0
            ? []
            : [
                {
                  id: "effort",
                  label: "Effort",
                  type: "select",
                  currentValue: model.efforts[0],
                  options: model.efforts.map((effort, effortIndex) => ({
                    id: effort,
                    label: effort.charAt(0).toUpperCase() + effort.slice(1),
                    ...(effortIndex === 0 ? { isDefault: true } : {}),
                  })),
                },
              ],
      }),
    }),
  );
});

/** Read the provider-owned split quota report without starting an agent turn. */
export const readAntigravityUsage = Effect.fn("readAntigravityUsage")(function* (
  config: AntigravitySettings,
  baseEnvironment: NodeJS.ProcessEnv,
): Effect.fn.Return<
  ReturnType<typeof parseAntigravityUsage>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const environment = makeAntigravityEnvironment(config, baseEnvironment);
  const result = yield* runAntigravityCommand(
    config,
    ["-p", "/usage", "--output-format", "text"],
    environment,
  ).pipe(Effect.timeoutOption(MODELS_PROBE_TIMEOUT_MS), Effect.result);
  if (Result.isFailure(result) || Option.isNone(result.success)) return undefined;

  const command = result.success.value;
  if (command.code !== 0) return undefined;
  return parseAntigravityUsage(command.stdout);
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

    const versionResult = yield* runAntigravityCommand(config, ["--version"], environment, [
      environment,
      baseEnvironment,
    ]).pipe(Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS), Effect.result);

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

    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
    const slashCommands = enrichAntigravitySlashCommands(parsedVersion);
    const discovered = yield* readAntigravityModels(config, environment);
    const accountEmail = yield* Effect.promise(() =>
      readAntigravityAccountEmail(resolveAntigravityDataHome(config, environment)),
    );
    const models =
      discovered.length > 0
        ? providerModelsFromSettings(discovered, config.customModels, EMPTY_CAPABILITIES)
        : fallbackModels;
    const authenticated = discovered.length > 0;

    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: config.enabled,
      checkedAt,
      models,
      slashCommands,
      probe: {
        installed: true,
        version: parsedVersion,
        status: authenticated ? "ready" : "warning",
        auth: authenticated
          ? {
              status: "authenticated",
              type: "antigravity",
              label: "Antigravity CLI",
              ...(accountEmail ? { email: accountEmail } : {}),
            }
          : { status: "unknown" },
        ...(!authenticated
          ? {
              message:
                "T3 could not verify the Antigravity login or read its model catalogue. Run `agy` on this server to sign in, then refresh providers.",
            }
          : {}),
      },
    });
  },
);
