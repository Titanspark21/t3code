/**
 * KiloDriver — `ProviderDriver` for the fork's Kilo provider.
 *
 * Mirrors `AmpDriver` / `GeminiCliDriver`: per-instance closures over
 * `GenericProviderSettings`, one `KiloServerManager` per instance.
 *
 * @module provider/Drivers/KiloDriver
 */
import {
  GenericProviderSettings,
  ProviderDriverKind,
  type ServerProvider,
  TextGenerationError,
} from "@t3tools/contracts";
import { Duration, Effect, Schema, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeKiloAdapter } from "../Layers/KiloAdapter.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { buildServerProvider, type ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import type { TextGenerationShape } from "../../git/Services/TextGeneration.ts";

const DRIVER_KIND = ProviderDriverKind.make("kilo");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export type KiloDriverEnv = ProviderEventLoggers | ServerConfig;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

function makePendingSnapshot(config: GenericProviderSettings): ServerProviderDraft {
  return buildServerProvider({
    presentation: { displayName: "Kilo" },
    enabled: config.enabled,
    checkedAt: new Date(0).toISOString(),
    models: [],
    skills: [],
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Probing Kilo installation…",
    },
  });
}

function buildSnapshot(config: GenericProviderSettings): ServerProviderDraft {
  return buildServerProvider({
    presentation: { displayName: "Kilo" },
    enabled: config.enabled,
    checkedAt: new Date().toISOString(),
    models: [],
    skills: [],
    probe: {
      installed: true,
      version: null,
      status: config.enabled ? "ready" : "error",
      auth: { status: "unknown" },
      // TODO(sync): port the real `kilo --version` probe.
    },
  });
}

const unsupportedTextGen = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail: "Kilo does not support text generation.",
    }),
  );

const kiloTextGeneration: TextGenerationShape = {
  generateCommitMessage: () => unsupportedTextGen("generateCommitMessage"),
  generatePrContent: () => unsupportedTextGen("generatePrContent"),
  generateBranchName: () => unsupportedTextGen("generateBranchName"),
  generateThreadTitle: () => unsupportedTextGen("generateThreadTitle"),
};

export const KiloDriver: ProviderDriver<GenericProviderSettings, KiloDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Kilo",
    supportsMultipleInstances: true,
  },
  configSchema: GenericProviderSettings,
  defaultConfig: (): GenericProviderSettings => Schema.decodeSync(GenericProviderSettings)({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const processEnv = mergeProviderInstanceEnvironment(environment);
      void processEnv;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies GenericProviderSettings;

      const adapter = yield* makeKiloAdapter(effectiveConfig, { instanceId }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to construct Kilo adapter: ${String((cause as Error)?.message ?? cause)}`,
              cause,
            }),
        ),
      );

      const snapshot = yield* makeManagedServerProvider<GenericProviderSettings>({
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) => stampIdentity(makePendingSnapshot(settings)),
        checkProvider: Effect.succeed(stampIdentity(buildSnapshot(effectiveConfig))),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Kilo snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration: kiloTextGeneration,
      } satisfies ProviderInstance;
    }),
};
