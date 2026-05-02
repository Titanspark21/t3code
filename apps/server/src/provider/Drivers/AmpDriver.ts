/**
 * AmpDriver — `ProviderDriver` for the fork's Amp provider.
 *
 * Bundles per-instance `snapshot` / `adapter` / `textGeneration` closures
 * over `GenericProviderSettings`. Multi-instance safe: two configurations
 * yield two independent `AmpServerManager` processes with their own
 * binary paths and runtime event queues.
 *
 * Text generation is not supported by the Amp CLI today — the
 * `textGeneration` shape returns a `TextGenerationError` for every call so
 * routing can degrade gracefully instead of crashing.
 *
 * @module provider/Drivers/AmpDriver
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
import { makeAmpAdapter } from "../Layers/AmpAdapter.ts";
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

const DRIVER_KIND = ProviderDriverKind.make("amp");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export type AmpDriverEnv = ProviderEventLoggers | ServerConfig;

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
    presentation: { displayName: "Amp" },
    enabled: config.enabled,
    checkedAt: new Date(0).toISOString(),
    models: [],
    skills: [],
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Probing Amp installation…",
    },
  });
}

function buildSnapshot(config: GenericProviderSettings): ServerProviderDraft {
  // The fork historically did a runtime probe via `amp --version`. Until that
  // probe is ported, render an "available when enabled" snapshot — matches
  // the pre-sync UI behavior of "rely on the binary at session start" and
  // keeps the row visible.
  return buildServerProvider({
    presentation: { displayName: "Amp" },
    enabled: config.enabled,
    checkedAt: new Date().toISOString(),
    models: [],
    skills: [],
    probe: {
      installed: true,
      version: null,
      status: config.enabled ? "ready" : "error",
      auth: { status: "unknown" },
      // TODO(sync): port the real `amp --version` probe so installed/version
      // reflect the actual binary state instead of being optimistic.
    },
  });
}

const unsupportedTextGen = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail: "Amp does not support text generation.",
    }),
  );

const ampTextGeneration: TextGenerationShape = {
  generateCommitMessage: () => unsupportedTextGen("generateCommitMessage"),
  generatePrContent: () => unsupportedTextGen("generatePrContent"),
  generateBranchName: () => unsupportedTextGen("generateBranchName"),
  generateThreadTitle: () => unsupportedTextGen("generateThreadTitle"),
};

export const AmpDriver: ProviderDriver<GenericProviderSettings, AmpDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Amp",
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

      const adapter = yield* makeAmpAdapter(effectiveConfig, { instanceId }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to construct Amp adapter: ${String((cause as Error)?.message ?? cause)}`,
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
              detail: `Failed to build Amp snapshot: ${cause.message ?? String(cause)}`,
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
        textGeneration: ampTextGeneration,
      } satisfies ProviderInstance;
    }),
};
