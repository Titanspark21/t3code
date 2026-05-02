/**
 * CopilotDriver — `ProviderDriver` for the fork's GitHub Copilot CLI.
 *
 * Per-instance closures over `GenericProviderSettings`. Delegates the heavy
 * 1.7k-line adapter body (in `Layers/CopilotAdapter.ts`) to
 * `makeCopilotAdapterImpl(config, options)` so each driver instance owns
 * its own `CopilotClient`, session map, and runtime-event queue.
 *
 * The adapter still lives behind a transitional shim — it was a singleton
 * `Context.Service` factory pre-sync, and the registry now hands it back
 * directly to the registry as a `ProviderInstance`. See the TODO(sync)
 * comment in `Layers/CopilotAdapter.ts` for the cleanup plan.
 *
 * Text generation is not supported — Copilot CLI does not expose a
 * suitable surface — so the four `TextGenerationShape` methods fail fast.
 *
 * @module provider/Drivers/CopilotDriver
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
import { makeCopilotAdapterImpl } from "../Layers/CopilotAdapter.ts";
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

const DRIVER_KIND = ProviderDriverKind.make("copilot");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export type CopilotDriverEnv = ProviderEventLoggers | ServerConfig;

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
    presentation: { displayName: "Copilot" },
    enabled: config.enabled,
    checkedAt: new Date(0).toISOString(),
    models: [],
    skills: [],
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Probing GitHub Copilot installation…",
    },
  });
}

function buildSnapshot(config: GenericProviderSettings): ServerProviderDraft {
  return buildServerProvider({
    presentation: { displayName: "Copilot" },
    enabled: config.enabled,
    checkedAt: new Date().toISOString(),
    models: [],
    skills: [],
    probe: {
      installed: true,
      version: null,
      status: config.enabled ? "ready" : "error",
      auth: { status: "unknown" },
      // TODO(sync): port the real `copilot --version` probe (the bundled
      // CLI path resolution lives in `copilotCliPath.ts`).
    },
  });
}

const unsupportedTextGen = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail: "Copilot does not support text generation.",
    }),
  );

const copilotTextGeneration: TextGenerationShape = {
  generateCommitMessage: () => unsupportedTextGen("generateCommitMessage"),
  generatePrContent: () => unsupportedTextGen("generatePrContent"),
  generateBranchName: () => unsupportedTextGen("generateBranchName"),
  generateThreadTitle: () => unsupportedTextGen("generateThreadTitle"),
};

export const CopilotDriver: ProviderDriver<GenericProviderSettings, CopilotDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Copilot",
    supportsMultipleInstances: true,
  },
  configSchema: GenericProviderSettings,
  defaultConfig: (): GenericProviderSettings => Schema.decodeSync(GenericProviderSettings)({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const eventLoggers = yield* ProviderEventLoggers;
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

      const adapter = yield* makeCopilotAdapterImpl(effectiveConfig, {
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to construct Copilot adapter: ${String((cause as Error)?.message ?? cause)}`,
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
              detail: `Failed to build Copilot snapshot: ${cause.message ?? String(cause)}`,
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
        textGeneration: copilotTextGeneration,
      } satisfies ProviderInstance;
    }),
};
