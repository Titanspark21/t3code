/**
 * CopilotDriver — stub `ProviderDriver` for the fork's Copilot adapter.
 *
 * The fork's `Layers/CopilotAdapter.ts` is a 1.8k-line wrapper around the
 * Copilot CLI that depends on `copilotCliPath.ts` + `copilotTurnTracking.ts`
 * helpers. Those still exist on disk but were tied to the old singleton
 * `Context.Service` shape; the upstream multi-instance refactor (PR #2277)
 * requires per-instance captured-closure factories instead.
 *
 * This stub registers the driver kind so configured instances surface as
 * "unavailable" shadow snapshots rather than disappearing on upgrade. Real
 * functionality lands when CopilotAdapter is refactored.
 *
 * TODO(sync): port CopilotAdapter into this driver, preserving
 * `copilotCliPath.ts` + `copilotTurnTracking.ts` as helper modules the
 * driver constructs per instance.
 *
 * @module provider/Drivers/CopilotDriver
 */
import { GenericProviderSettings, ProviderDriverKind } from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { ProviderDriverError } from "../Errors.ts";
import { type ProviderDriver } from "../ProviderDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("copilot");

export type CopilotDriverEnv = never;

export const CopilotDriver: ProviderDriver<GenericProviderSettings, CopilotDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Copilot",
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
          "Copilot driver is pending re-port onto the new driver-factory architecture; " +
          "configured instances surface as unavailable shadow snapshots until the " +
          "adapter is restored. See TODO(sync) in apps/server/src/provider/Drivers/CopilotDriver.ts.",
      }),
    ),
};
