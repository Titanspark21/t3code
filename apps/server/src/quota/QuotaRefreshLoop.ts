/**
 * Background refresh for account limits.
 *
 * Providers publish rate limits as a side effect of doing work, and the only
 * other trigger is a user pressing refresh. An account that is idle — or one
 * whose provider reports limits outside a turn, like Claude — therefore goes
 * quiet, its snapshot ages past the staleness horizon, and the panel silently
 * stops showing it. That reads as "tracking broke", which is the complaint
 * this loop exists to remove.
 *
 * Only instances whose snapshot has aged past `minimumAgeMs` are refreshed, so
 * an account that just reported during a turn does not pay for a second probe.
 *
 * @module quota/QuotaRefreshLoop
 */
import type { ProviderInstanceId, ProviderRuntimeEvent } from "@t3tools/contracts";
import type { QuotaSummary } from "@t3tools/contracts/quota";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

/** How often the loop wakes up. */
export const QUOTA_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * How stale a snapshot must be before it is worth a probe.
 *
 * A refresh spawns a provider process, so this is deliberately close to the
 * sweep interval: the loop tops up accounts that have gone quiet rather than
 * re-asking every account on every tick.
 */
export const QUOTA_REFRESH_MINIMUM_AGE_MS = 10 * 60 * 1000;

export interface QuotaRefreshLoopOptions {
  readonly intervalMs?: number;
  readonly minimumAgeMs?: number;
}

export interface QuotaRefreshLoopDependencies {
  readonly listInstanceIds: Effect.Effect<ReadonlyArray<ProviderInstanceId>>;
  readonly readSummary: Effect.Effect<QuotaSummary>;
  readonly refreshQuota: (
    instanceId?: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ProviderRuntimeEvent>>;
}

/**
 * Instances due for a probe: everything with no snapshot, plus everything whose
 * snapshot is older than `minimumAgeMs`.
 *
 * An unparseable `observedAt` counts as due — a snapshot we cannot date is one
 * we cannot claim is current.
 */
export function selectInstancesToRefresh(input: {
  readonly instanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly summary: QuotaSummary;
  readonly now: number;
  readonly minimumAgeMs: number;
}): ReadonlyArray<ProviderInstanceId> {
  const observedAt = new Map(
    input.summary.snapshots.map((snapshot) => [snapshot.providerInstanceId, snapshot.observedAt]),
  );
  return input.instanceIds.filter((instanceId) => {
    const seen = observedAt.get(instanceId);
    if (seen === undefined) return true;
    const parsed = Date.parse(seen);
    if (Number.isNaN(parsed)) return true;
    return input.now - parsed >= input.minimumAgeMs;
  });
}

/**
 * One sweep. Failures are already logged per instance by `refreshQuota`, and a
 * provider that cannot answer must not stop the others from being refreshed.
 */
export const makeQuotaRefreshSweep = (
  dependencies: QuotaRefreshLoopDependencies,
  options?: QuotaRefreshLoopOptions,
) =>
  Effect.gen(function* () {
    const minimumAgeMs = Math.max(0, options?.minimumAgeMs ?? QUOTA_REFRESH_MINIMUM_AGE_MS);
    const instanceIds = yield* dependencies.listInstanceIds;
    if (instanceIds.length === 0) return;
    const summary = yield* dependencies.readSummary;
    const now = yield* Clock.currentTimeMillis;
    const due = selectInstancesToRefresh({ instanceIds, summary, now, minimumAgeMs });

    for (const instanceId of due) {
      yield* dependencies
        .refreshQuota(instanceId)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("quota.refresh-loop.instance-failed", { instanceId, cause }),
          ),
        );
    }
  });

/** The sweep on a schedule. Fork this; it never completes. */
export const makeQuotaRefreshLoop = (
  dependencies: QuotaRefreshLoopDependencies,
  options?: QuotaRefreshLoopOptions,
) => {
  const intervalMs = Math.max(1, options?.intervalMs ?? QUOTA_REFRESH_INTERVAL_MS);
  return makeQuotaRefreshSweep(dependencies, options).pipe(
    Effect.catchCause((cause) => Effect.logWarning("quota.refresh-loop.sweep-failed", { cause })),
    Effect.repeat(Schedule.spaced(Duration.millis(intervalMs))),
  );
};
