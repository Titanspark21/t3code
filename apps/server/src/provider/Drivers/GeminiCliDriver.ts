/**
 * GeminiCliDriver — `ProviderDriver` for the fork's Gemini CLI provider.
 *
 * Mirrors `AmpDriver`: per-instance closures over `GenericProviderSettings`,
 * one `GeminiCliServerManager` per instance, no shared state.
 *
 * Text generation is not supported — the underlying CLI doesn't expose a
 * suitable surface — so all four `TextGenerationShape` methods fail fast.
 *
 * @module provider/Drivers/GeminiCliDriver
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
import { makeGeminiCliAdapter } from "../Layers/GeminiCliAdapter.ts";
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

const DRIVER_KIND = ProviderDriverKind.make("geminiCli");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export type GeminiCliDriverEnv = ProviderEventLoggers | ServerConfig;

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
    presentation: { displayName: "Gemini CLI" },
    enabled: config.enabled,
    checkedAt: new Date(0).toISOString(),
    models: [],
    skills: [],
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Probing Gemini CLI installation…",
    },
  });
}

function buildSnapshot(config: GenericProviderSettings): ServerProviderDraft {
  return buildServerProvider({
    presentation: { displayName: "Gemini CLI" },
    enabled: config.enabled,
    checkedAt: new Date().toISOString(),
    models: [],
    skills: [],
    probe: {
      installed: true,
      version: null,
      status: config.enabled ? "ready" : "error",
      auth: { status: "unknown" },
      // TODO(sync): port the real `gemini --version` probe.
    },
  });
}

const unsupportedTextGen = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail: "Gemini CLI does not support text generation.",
    }),
  );

const geminiCliTextGeneration: TextGenerationShape = {
  generateCommitMessage: () => unsupportedTextGen("generateCommitMessage"),
  generatePrContent: () => unsupportedTextGen("generatePrContent"),
  generateBranchName: () => unsupportedTextGen("generateBranchName"),
  generateThreadTitle: () => unsupportedTextGen("generateThreadTitle"),
};

export const GeminiCliDriver: ProviderDriver<GenericProviderSettings, GeminiCliDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Gemini CLI",
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

      const adapter = yield* makeGeminiCliAdapter(effectiveConfig, { instanceId }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to construct Gemini CLI adapter: ${String((cause as Error)?.message ?? cause)}`,
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
              detail: `Failed to build Gemini CLI snapshot: ${cause.message ?? String(cause)}`,
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
        textGeneration: geminiCliTextGeneration,
      } satisfies ProviderInstance;
    }),
};
