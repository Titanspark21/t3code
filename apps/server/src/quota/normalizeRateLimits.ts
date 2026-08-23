// @effect-diagnostics globalDate:off - pure normalizer; converts provider epochs, reads no clock.
/**
 * Normalizes each provider's `account.rate-limits.updated` payload into the
 * shared `AccountQuotaSnapshot` shape.
 *
 * Both the Codex and Claude adapters already emit that runtime event with the
 * provider's raw payload attached (`CodexAdapter.ts`, `ClaudeAdapter.ts`);
 * before this module nothing consumed it. These functions are the whole
 * provider-specific surface — everything downstream reads the normalized shape
 * and does not know which agent produced it.
 *
 * Pure and total by construction: every function takes `unknown` and returns a
 * snapshot or `undefined`. A payload that changed shape yields `undefined`,
 * which the UI renders as "not exposed". It must never yield a plausible-looking
 * number, because a wrong quota figure is worse than an absent one — it gets
 * trusted.
 *
 * Fork-local (OmniCode). See `OMNI.md`.
 *
 * @module quota/normalizeRateLimits
 */
import type {
  AccountQuotaSnapshot,
  QuotaGroup,
  QuotaSource,
  QuotaWindow,
} from "@t3tools/contracts/quota";
import { quotaWindowKindFromDuration } from "@t3tools/contracts/quota";
import type { ProviderInstanceId } from "@t3tools/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = source[key];
  return isRecord(value) ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Clamp to 0–100. Providers have been observed reporting slightly over 100 on
 * a freshly exhausted window; that is a real "you are out", not a reason to
 * discard the reading.
 */
function readUsedPercent(value: unknown): number | undefined {
  const raw = readFiniteNumber(value);
  if (raw === undefined) return undefined;
  return Math.min(100, Math.max(0, raw));
}

/**
 * Epoch seconds to ISO.
 *
 * Codex publishes `resetsAt` in **seconds**, not milliseconds — mixing those up
 * puts every reset time in 1970 or the year 57000. Values are sanity-checked
 * against a plausible range rather than trusted, and anything outside it is
 * dropped instead of displayed.
 */
const MIN_PLAUSIBLE_EPOCH_SECONDS = 1_000_000_000; // 2001-09-09
const MAX_PLAUSIBLE_EPOCH_SECONDS = 4_102_444_800; // 2100-01-01

export function isoFromEpochSeconds(value: unknown): string | undefined {
  const seconds = readFiniteNumber(value);
  if (seconds === undefined) return undefined;
  if (seconds < MIN_PLAUSIBLE_EPOCH_SECONDS || seconds > MAX_PLAUSIBLE_EPOCH_SECONDS) {
    return undefined;
  }
  const date = new Date(seconds * 1000);
  const iso = date.toISOString();
  return Number.isNaN(date.getTime()) ? undefined : iso;
}

/**
 * One `{ usedPercent, resetsAt?, windowDurationMins? }` window.
 *
 * `usedPercent` is the only required field: a window with no percentage tells
 * us nothing, so it is dropped rather than shown at zero.
 */
function normalizeWindow(value: unknown, fallbackLabel?: string): QuotaWindow | undefined {
  if (!isRecord(value)) return undefined;
  const usedPercent = readUsedPercent(value["usedPercent"] ?? value["used_percent"]);
  if (usedPercent === undefined) return undefined;

  const windowDurationMins = readFiniteNumber(
    value["windowDurationMins"] ?? value["window_minutes"],
  );
  const resetsAt = isoFromEpochSeconds(value["resetsAt"] ?? value["resets_at"]);
  const label = readNonEmptyString(value["label"]) ?? fallbackLabel;

  return {
    kind: quotaWindowKindFromDuration(windowDurationMins),
    usedPercent,
    ...(label ? { label } : {}),
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowDurationMins !== undefined && windowDurationMins > 0 ? { windowDurationMins } : {}),
  };
}

/**
 * Codex — `account/rateLimits/updated`, schema
 * `V2AccountRateLimitsUpdatedNotification` in `packages/effect-codex-app-server`.
 *
 * The payload is explicitly documented as a **sparse rolling update**: fields
 * absent from one message do not clear a previously observed value. Merging is
 * the caller's job (see `mergeQuotaSnapshots`); this function reports only what
 * this message actually carried.
 */
export function normalizeCodexRateLimits(input: {
  readonly providerInstanceId: ProviderInstanceId;
  readonly payload: unknown;
  readonly observedAt: string;
}): AccountQuotaSnapshot | undefined {
  if (!isRecord(input.payload)) return undefined;

  // The adapter wraps the notification as `{ rateLimits: <notification> }`, and
  // the notification itself nests a `rateLimits` snapshot. Accept either depth
  // so a future unwrap upstream does not silently blank the panel.
  const outer = readRecord(input.payload, "rateLimits") ?? input.payload;
  const snapshot = readRecord(outer, "rateLimits") ?? outer;

  const windows: Array<QuotaWindow> = [];
  const primary = normalizeWindow(snapshot["primary"]);
  if (primary) windows.push(primary);
  const secondary = normalizeWindow(snapshot["secondary"]);
  if (secondary) windows.push(secondary);

  const limitReached = readNonEmptyString(
    snapshot["rateLimitReachedType"] ?? snapshot["rate_limit_reached_type"],
  );

  // Nothing usable in this message. Absent beats an empty-looking row.
  if (windows.length === 0 && !limitReached) return undefined;

  const displayName =
    readNonEmptyString(snapshot["limitName"] ?? snapshot["limit_name"]) ?? "Subscription";
  const planType = readNonEmptyString(snapshot["planType"] ?? snapshot["plan_type"]);

  const group: QuotaGroup = { key: "default", displayName, windows };

  return {
    providerInstanceId: input.providerInstanceId,
    groups: [group],
    source: "provider-event" satisfies QuotaSource,
    observedAt: input.observedAt,
    ...(planType ? { planType } : {}),
    ...(limitReached ? { limitReached } : {}),
  };
}

/**
 * Claude — the Agent SDK's `rate_limit_event` message, forwarded whole by
 * `ClaudeAdapter.ts`.
 *
 * Unlike Codex there is no generated schema for this in the repo, and the SDK's
 * own types have carried wire-only fields before. So this reads defensively
 * across the shapes the SDK has been observed to use rather than pinning one:
 * a nested `rateLimits`/`rate_limits` object, or the windows inline. Anything
 * unrecognized returns `undefined` and the row reads "not exposed" — which is
 * the correct answer until someone confirms the real shape against a live
 * account.
 */
export function normalizeClaudeRateLimits(input: {
  readonly providerInstanceId: ProviderInstanceId;
  readonly payload: unknown;
  readonly observedAt: string;
}): AccountQuotaSnapshot | undefined {
  if (!isRecord(input.payload)) return undefined;

  const outer = readRecord(input.payload, "rateLimits") ?? input.payload;
  const snapshot = readRecord(outer, "rateLimits") ?? readRecord(outer, "rate_limits") ?? outer;

  const windows: Array<QuotaWindow> = [];

  // Named windows, when the SDK labels them.
  for (const [key, label] of [
    ["primary", "Session limit"],
    ["secondary", "Weekly limit"],
    ["five_hour", "5-hour limit"],
    ["fiveHour", "5-hour limit"],
    ["weekly", "Weekly limit"],
  ] as const) {
    const window = normalizeWindow(snapshot[key], label);
    if (window) windows.push(window);
  }

  // Or a plain list of windows.
  const listed = snapshot["windows"];
  if (Array.isArray(listed)) {
    for (const entry of listed) {
      const window = normalizeWindow(entry);
      if (window) windows.push(window);
    }
  }

  const limitReached =
    readNonEmptyString(snapshot["rateLimitReachedType"]) ??
    readNonEmptyString(snapshot["status"]) ??
    (snapshot["limitReached"] === true ? "rate_limit_reached" : undefined);

  if (windows.length === 0 && !limitReached) return undefined;

  return {
    providerInstanceId: input.providerInstanceId,
    groups: [{ key: "default", displayName: "Subscription", windows }],
    source: "provider-event" satisfies QuotaSource,
    observedAt: input.observedAt,
    ...(limitReached ? { limitReached } : {}),
  };
}

/**
 * Merge a newer sparse update onto the last known snapshot.
 *
 * Required because Codex documents its updates as sparse: a rolling message
 * carrying only `primary` must not erase the `secondary` window a person is
 * relying on. Windows are merged by kind, with the newer reading winning; a
 * group present only in the older snapshot is preserved.
 *
 * `limitReached` is the exception — it is *not* carried forward, because a
 * stale "you are rate limited" that outlives the reset is precisely the state
 * that makes an account look permanently broken.
 */
export function mergeQuotaSnapshots(
  previous: AccountQuotaSnapshot | undefined,
  next: AccountQuotaSnapshot,
): AccountQuotaSnapshot {
  if (!previous) return next;
  if (previous.providerInstanceId !== next.providerInstanceId) return next;

  const groupsByKey = new Map<string, QuotaGroup>();
  for (const group of previous.groups) groupsByKey.set(group.key, group);

  for (const incoming of next.groups) {
    const existing = groupsByKey.get(incoming.key);
    if (!existing) {
      groupsByKey.set(incoming.key, incoming);
      continue;
    }

    const windowsByKind = new Map<string, QuotaWindow>();
    for (const window of existing.windows) {
      windowsByKind.set(`${window.kind}:${window.label ?? ""}`, window);
    }
    for (const window of incoming.windows) {
      windowsByKind.set(`${window.kind}:${window.label ?? ""}`, window);
    }

    groupsByKey.set(incoming.key, {
      key: incoming.key,
      displayName: incoming.displayName,
      windows: [...windowsByKind.values()],
    });
  }

  return {
    providerInstanceId: next.providerInstanceId,
    groups: [...groupsByKey.values()],
    source: next.source,
    observedAt: next.observedAt,
    ...((next.planType ?? previous.planType)
      ? { planType: next.planType ?? previous.planType! }
      : {}),
    ...(next.limitReached ? { limitReached: next.limitReached } : {}),
  };
}
