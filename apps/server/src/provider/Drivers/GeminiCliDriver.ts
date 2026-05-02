/**
 * GeminiCliDriver — stub `ProviderDriver` for the fork's Gemini CLI adapter.
 *
 * The fork's `Layers/GeminiCliAdapter.ts` wrapped `GeminiCliServerManager`,
 * registered as a singleton `Context.Service`. Upstream's PR #2277 swapped
 * to per-instance factory closures, which the old adapter doesn't satisfy.
 *
 * This stub keeps the driver kind registered so configured instances surface
 * as "unavailable" shadow snapshots until the adapter is rebuilt.
 *
 * TODO(sync): port GeminiCliAdapter into this driver as captured-closure
 * adapter/textGeneration/snapshot bundles.
 *
 * @module provider/Drivers/GeminiCliDriver
 */
import { GenericProviderSettings, ProviderDriverKind } from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { ProviderDriverError } from "../Errors.ts";
import { type ProviderDriver } from "../ProviderDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("geminiCli");

export type GeminiCliDriverEnv = never;

export const GeminiCliDriver: ProviderDriver<GenericProviderSettings, GeminiCliDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Gemini CLI",
    supportsMultipleInstances: true,
  },
  configSchema: GenericProviderSettings,
  defaultConfig: (): GenericProviderSettings => Schema.decodeSync(GenericProviderSettings)({}),
  create: ({ instanceId }) =>
    Effect.fail(
      new ProviderDriverError({
        driver: DRIVER_KIND,
        instanceId,
        detail:
          "Gemini CLI driver is pending re-port onto the new driver-factory architecture; " +
          "configured instances surface as unavailable shadow snapshots until the " +
          "adapter is restored. See TODO(sync) in apps/server/src/provider/Drivers/GeminiCliDriver.ts.",
      }),
    ),
};
