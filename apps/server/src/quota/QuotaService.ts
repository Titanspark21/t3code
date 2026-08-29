/**
 * Live, instance-keyed subscription quota state.
 *
 * Runtime ingestion feeds canonical provider events into this service. The
 * service publishes only when the pure reducer returns a new state object, so
 * assistant deltas and other unrelated runtime traffic never fan out into
 * sidebar renders.
 *
 * @module quota/QuotaService
 */
import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import {
  type AccountQuotaSnapshot,
  QUOTA_CONTRACT_VERSION,
  type QuotaSummary,
} from "@t3tools/contracts/quota";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { applyQuotaEvent, emptyQuotaState, type QuotaState } from "./quotaReducer.ts";

export class QuotaService extends Context.Service<
  QuotaService,
  {
    readonly readSummary: Effect.Effect<QuotaSummary>;
    readonly ingest: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
    readonly seedSnapshot: (snapshot: AccountQuotaSnapshot) => Effect.Effect<void>;
    readonly changes: Stream.Stream<QuotaSummary>;
  }
>()("t3/quota/QuotaService") {}

function summaryFromState(state: QuotaState): QuotaSummary {
  return {
    contractVersion: QUOTA_CONTRACT_VERSION,
    snapshots: [...state.values()].sort((left, right) =>
      String(left.providerInstanceId).localeCompare(String(right.providerInstanceId)),
    ),
  };
}

export const make = Effect.gen(function* () {
  const state = yield* SubscriptionRef.make<QuotaState>(emptyQuotaState);

  const ingest = Effect.fn("QuotaService.ingest")(function* (event: ProviderRuntimeEvent) {
    const providerInstanceId = event.providerInstanceId;
    if (providerInstanceId === undefined) return;

    yield* SubscriptionRef.updateSome(state, (current) => {
      const existing = current.get(providerInstanceId);
      // A manual refresh is ingested synchronously by the RPC and also
      // arrives a moment later through ProviderRuntimeIngestion. Ignore that
      // same event timestamp on the second path instead of publishing the
      // same snapshot twice.
      if (existing && existing.observedAt === event.createdAt) {
        return Option.none();
      }
      const next = applyQuotaEvent(current, {
        providerInstanceId,
        driverKind: event.provider,
        event,
        observedAt: event.createdAt,
      });
      return next === current ? Option.none() : Option.some(next);
    });
  });

  const seedSnapshot = Effect.fn("QuotaService.seedSnapshot")(function* (
    snapshot: AccountQuotaSnapshot,
  ) {
    yield* SubscriptionRef.updateSome(state, (current) => {
      const existing = current.get(snapshot.providerInstanceId);
      if (existing && Date.parse(existing.observedAt) >= Date.parse(snapshot.observedAt)) {
        return Option.none();
      }
      const next = new Map(current);
      next.set(snapshot.providerInstanceId, snapshot);
      return Option.some(next);
    });
  });

  return QuotaService.of({
    readSummary: SubscriptionRef.get(state).pipe(Effect.map(summaryFromState)),
    ingest,
    seedSnapshot,
    changes: SubscriptionRef.changes(state).pipe(Stream.map(summaryFromState)),
  });
});

export const layer = Layer.effect(QuotaService, make);

/** Empty service for tests whose RPC surface needs the dependency but not quota events. */
export const layerTest = Layer.succeed(
  QuotaService,
  QuotaService.of({
    readSummary: Effect.succeed({
      contractVersion: QUOTA_CONTRACT_VERSION,
      snapshots: [],
    }),
    ingest: () => Effect.void,
    seedSnapshot: () => Effect.void,
    changes: Stream.succeed({
      contractVersion: QUOTA_CONTRACT_VERSION,
      snapshots: [],
    }),
  }),
);
