/**
 * CopilotAdapter — legacy Service-tag wrapper for the fork's Copilot
 * adapter shape.
 *
 * The driver-based architecture no longer instantiates this Service tag
 * (drivers return `ProviderAdapterShape` values directly to the registry).
 * The shape interface is kept as the typed return contract for
 * `makeCopilotAdapterImpl` so the existing 1.7k-line adapter body and its
 * tests can keep referencing `CopilotAdapterShape` without churn.
 *
 * TODO(sync): once the adapter body is inlined into `CopilotDriver.ts`,
 * delete the Service tag entirely and have the body declare its own
 * concrete type.
 *
 * @module provider/Services/CopilotAdapter
 */
import { Context } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface CopilotAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

/**
 * Vestigial Service tag — kept around so any code path that still imports
 * `CopilotAdapter` (e.g. transition-period tests) continues to compile.
 * Driver-based instantiation does not provide this layer; consumers should
 * read instances from `ProviderInstanceRegistry` instead.
 */
export class CopilotAdapter extends Context.Service<CopilotAdapter, CopilotAdapterShape>()(
  "t3/provider/Services/CopilotAdapter",
) {}
