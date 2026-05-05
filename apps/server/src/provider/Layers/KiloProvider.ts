/**
 * KiloProvider — snapshot probe for the Kilo Code provider.
 *
 * Kilo is a fork of OpenCode and exposes the same HTTP+SSE API. The probe
 * is per-instance: it uses the per-driver `KiloSettings` (currently
 * `GenericProviderSettings`) to resolve `binaryPath`, then runs
 * `kilo --version` to confirm the binary is installed. Authentication is
 * not validated here — the Kilo server handles that lazily on first
 * session. Custom models are surfaced via `customModels`.
 *
 * Two helpers are exported:
 *   - `checkKiloProviderStatus`   — full probe used by the driver's
 *     `makeManagedServerProvider` refresh.
 *   - `makePendingKiloProvider`   — synchronous "checking…" snapshot that
 *     `makeManagedServerProvider` publishes as the initial value.
 *
 * @module provider/Layers/KiloProvider
 */
import {
  ProviderDriverKind,
  type GenericProviderSettings,
  type ModelCapabilities,
} from "@t3tools/contracts";
import { Effect, Option, Path, Result } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("kilo");
const KILO_PRESENTATION = {
  displayName: "Kilo Code",
  showInteractionModeToggle: true,
} as const;

const DEFAULT_KILO_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export type KiloSettings = GenericProviderSettings;

const runKiloCommand = Effect.fn("runKiloCommand")(function* (
  kiloSettings: KiloSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const binaryPath = kiloSettings.binaryPath.trim() || "kilo";
  const command = ChildProcess.make(binaryPath, [...args], {
    env: environment,
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(binaryPath, command);
});

export const checkKiloProviderStatus = Effect.fn("checkKiloProviderStatus")(function* (
  kiloSettings: KiloSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const checkedAt = new Date().toISOString();
  const allModels = providerModelsFromSettings(
    [],
    PROVIDER,
    kiloSettings.customModels,
    DEFAULT_KILO_MODEL_CAPABILITIES,
  );

  if (!kiloSettings.enabled) {
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Kilo is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runKiloCommand(kiloSettings, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: kiloSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Kilo CLI (`kilo`) is not installed or not on PATH."
          : `Failed to execute Kilo CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: kiloSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Kilo CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: kiloSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Kilo CLI is installed but failed to run. ${detail}`
          : "Kilo CLI is installed but failed to run.",
      },
    });
  }

  return buildServerProvider({
    presentation: KILO_PRESENTATION,
    enabled: true,
    checkedAt,
    models: allModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: {
        status: "authenticated",
        type: "kilo",
      },
      message: parsedVersion
        ? `Kilo v${parsedVersion} detected.`
        : "Kilo CLI detected.",
    },
  });
});

export const makePendingKiloProvider = (kiloSettings: KiloSettings): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    [],
    PROVIDER,
    kiloSettings.customModels,
    DEFAULT_KILO_MODEL_CAPABILITIES,
  );

  if (!kiloSettings.enabled) {
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Kilo is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: KILO_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Kilo provider status has not been checked in this session yet.",
    },
  });
};
