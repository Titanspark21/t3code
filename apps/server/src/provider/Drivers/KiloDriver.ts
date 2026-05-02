/**
 * KiloDriver — stub `ProviderDriver` for the fork's Kilo adapter.
 *
 * The fork's `Layers/KiloAdapter.ts` wrapped `KiloServerManager`, registered
 * as a singleton `Context.Service`. Upstream's PR #2277 swapped to
 * per-instance factory closures, which the old adapter doesn't satisfy.
 *
 * This stub keeps the driver kind registered so configured instances surface
 * as "unavailable" shadow snapshots until the adapter is rebuilt.
 *
 * TODO(sync): port KiloAdapter into this driver as captured-closure
 * adapter/textGeneration/snapshot bundles.
 *
 * @module provider/Drivers/KiloDriver
 */
import { GenericProviderSettings, ProviderDriverKind } from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { ProviderDriverError } from "../Errors.ts";
import { type ProviderDriver } from "../ProviderDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("kilo");

export type KiloDriverEnv = never;

export const KiloDriver: ProviderDriver<GenericProviderSettings, KiloDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Kilo",
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
          "Kilo driver is pending re-port onto the new driver-factory architecture; " +
          "configured instances surface as unavailable shadow snapshots until the " +
          "adapter is restored. See TODO(sync) in apps/server/src/provider/Drivers/KiloDriver.ts.",
      }),
    ),
};
