/**
 * AmpDriver — stub `ProviderDriver` for the fork's Amp adapter.
 *
 * The fork historically shipped a `Layers/AmpAdapter.ts` that wrapped
 * `AmpServerManager` (a Node EventEmitter). That adapter was tied to the
 * old singleton `Context.Service` shape and does not satisfy upstream's
 * new `ProviderDriver` SPI.
 *
 * To preserve registration of the driver kind so users see it surface as
 * an "unavailable" shadow snapshot rather than disappear entirely, this
 * stub fails its `create()` with a clear migration message. Real
 * functionality returns once the adapter is reimplemented as a per-
 * instance factory matching CodexDriver.
 *
 * TODO(sync): port the fork's AmpAdapter + AmpServerManager into this
 * driver as captured-closure adapter/textGeneration/snapshot bundles.
 *
 * @module provider/Drivers/AmpDriver
 */
import { GenericProviderSettings, ProviderDriverKind } from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { ProviderDriverError } from "../Errors.ts";
import { type ProviderDriver } from "../ProviderDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("amp");

export type AmpDriverEnv = never;

export const AmpDriver: ProviderDriver<GenericProviderSettings, AmpDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Amp",
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
          "Amp driver is pending re-port onto the new driver-factory architecture; " +
          "configured instances surface as unavailable shadow snapshots until the " +
          "adapter is restored. See TODO(sync) in apps/server/src/provider/Drivers/AmpDriver.ts.",
      }),
    ),
};
