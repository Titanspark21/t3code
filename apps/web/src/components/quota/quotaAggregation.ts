import {
  isQuotaSnapshotStale,
  primaryQuotaWindow,
  type AccountQuotaSnapshot,
  type QuotaGroup,
  type QuotaWindow,
} from "@t3tools/contracts/quota";
import type { ProviderDriverKind } from "@t3tools/contracts";

export interface QuotaAggregationAccount {
  readonly key: string;
  readonly instance: {
    readonly driverKind: ProviderDriverKind;
    readonly displayName: string;
  };
  readonly snapshot: AccountQuotaSnapshot | undefined;
}

export type QuotaPanelRow<TAccount extends QuotaAggregationAccount> = {
  readonly kind: "account";
  readonly account: TAccount;
};

export type QuotaWindowKindForDisplay = "short" | "long";

/** Pick the most constrained window of one duration from a provider snapshot. */
export function quotaWindowForKind(
  snapshot: AccountQuotaSnapshot | undefined,
  kind: QuotaWindowKindForDisplay,
  nowMs: number = Date.now(),
): QuotaWindow | undefined {
  if (!snapshot || isQuotaSnapshotStale(snapshot, nowMs)) return undefined;
  const windows = snapshot.groups.flatMap((group) => group.windows);
  const matching = windows.filter((window) => window.kind === kind);
  if (matching.length > 0) return primaryQuotaWindow(matching);

  // Some Claude SDK versions omit duration metadata but retain a descriptive
  // label. This fallback keeps those readings visible without using position
  // in the provider's response as an implicit contract.
  const labelPattern = kind === "short" ? /5.?hour|session/i : /week|seven.?day/i;
  return primaryQuotaWindow(windows.filter((window) => labelPattern.test(window.label ?? "")));
}

export type AntigravityQuotaPool = "gemini" | "claude-gpt";

function groupMatchesPool(group: QuotaGroup, pool: AntigravityQuotaPool): boolean {
  const identity = `${group.key} ${group.displayName}`.toLowerCase();
  return pool === "gemini" ? /gemini|google/.test(identity) : /claude|gpt|other/.test(identity);
}

/** Find one Antigravity pool's weekly window. */
export function antigravityQuotaWindow(
  snapshot: AccountQuotaSnapshot | undefined,
  pool: AntigravityQuotaPool,
  nowMs: number = Date.now(),
): QuotaWindow | undefined {
  if (!snapshot || isQuotaSnapshotStale(snapshot, nowMs)) return undefined;
  const group = snapshot.groups.find((candidate) => groupMatchesPool(candidate, pool));
  if (!group) return undefined;
  const weekly = group.windows.filter(
    (window) => window.kind === "long" || /week|seven.?day/i.test(window.label ?? ""),
  );
  return primaryQuotaWindow(weekly);
}

/**
 * Average one Antigravity pool across fresh accounts. A reset is carried onto
 * the aggregate only when every contributing account publishes the same one;
 * otherwise the UI labels the aggregate as having varying reset times.
 */
export function averageAntigravityQuotaWindow(
  accounts: ReadonlyArray<QuotaAggregationAccount>,
  pool: AntigravityQuotaPool,
  nowMs: number,
): QuotaWindow | undefined {
  const windows = freshAntigravityQuotaWindows(accounts, pool, nowMs);
  if (windows.length === 0) return undefined;

  const resetTimes = new Set(windows.map((window) => window.resetsAt));
  const sharedReset = resetTimes.size === 1 ? windows[0]?.resetsAt : undefined;

  return {
    kind: "long",
    label: "Weekly limit",
    usedPercent: windows.reduce((sum, window) => sum + window.usedPercent, 0) / windows.length,
    windowDurationMins: 10_080,
    ...(sharedReset ? { resetsAt: sharedReset } : {}),
  };
}

/** Return a compact label when an aggregate cannot have one honest reset time. */
export function antigravityAggregateResetLabel(
  accounts: ReadonlyArray<QuotaAggregationAccount>,
  pool: AntigravityQuotaPool,
  nowMs: number,
): string | undefined {
  const windows = freshAntigravityQuotaWindows(accounts, pool, nowMs);
  if (windows.length === 0) return undefined;
  const resetTimes = new Set(windows.map((window) => window.resetsAt ?? "missing"));
  return resetTimes.size > 1 ? "reset varies" : undefined;
}

function freshAntigravityQuotaWindows(
  accounts: ReadonlyArray<QuotaAggregationAccount>,
  pool: AntigravityQuotaPool,
  nowMs: number,
): ReadonlyArray<QuotaWindow> {
  return accounts.flatMap((account) => {
    const snapshot = account.snapshot;
    if (!snapshot || isQuotaSnapshotStale(snapshot, nowMs)) return [];
    const window = antigravityQuotaWindow(snapshot, pool, nowMs);
    return window ? [window] : [];
  });
}

/**
 * Keep one row per configured account label across all connected environments.
 *
 * Provider instance ids are routing keys inside one environment. The same
 * account configured on Windows and Linux can therefore arrive with different
 * environment-qualified row keys even when the user intentionally gave it the
 * same name. The configured display name is the account identity used by the
 * sidebar, preserving the first-seen order while selecting the newest snapshot
 * from the connected environments.
 */
export function groupQuotaPanelAccounts<TAccount extends QuotaAggregationAccount>(
  accounts: ReadonlyArray<TAccount>,
): ReadonlyArray<QuotaPanelRow<TAccount>> {
  const grouped = new Map<string, TAccount>();

  for (const account of accounts) {
    const displayName = account.instance.displayName.trim() || account.key;
    const identity = `${account.instance.driverKind}:${displayName.toLocaleLowerCase()}`;
    const existing = grouped.get(identity);
    if (!existing) {
      grouped.set(identity, { ...account, key: identity });
      continue;
    }

    const snapshot = latestSnapshot(existing.snapshot, account.snapshot);
    if (snapshot !== existing.snapshot) {
      grouped.set(identity, { ...existing, snapshot });
    }
  }

  return [...grouped.values()].map((account) => ({ kind: "account", account }));
}

function latestSnapshot(
  left: AccountQuotaSnapshot | undefined,
  right: AccountQuotaSnapshot | undefined,
): AccountQuotaSnapshot | undefined {
  if (!left) return right;
  if (!right) return left;

  const leftObservedAt = Date.parse(left.observedAt);
  const rightObservedAt = Date.parse(right.observedAt);
  if (Number.isNaN(leftObservedAt)) return right;
  if (Number.isNaN(rightObservedAt) || rightObservedAt <= leftObservedAt) return left;
  return right;
}

function quotaRemainingPercentExact(usedPercent: number): number {
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

/**
 * Compute one account's representative remaining percentage. Antigravity
 * publishes independent pools, so choose the closest-to-exhaustion window in
 * each pool and average those pool figures before rounding for display.
 */
export function accountQuotaRemainingPercent(
  snapshot: AccountQuotaSnapshot | undefined,
  nowMs: number,
): number | undefined {
  if (!snapshot || isQuotaSnapshotStale(snapshot, nowMs)) return undefined;

  const poolRemaining = snapshot.groups.flatMap((group) => {
    const primary = primaryQuotaWindow(group.windows);
    return primary ? [quotaRemainingPercentExact(primary.usedPercent)] : [];
  });
  if (poolRemaining.length === 0) return undefined;

  return Math.round(
    poolRemaining.reduce((sum, remaining) => sum + remaining, 0) / poolRemaining.length,
  );
}

export interface AntigravityQuotaSummary {
  readonly averageRemainingPercent: number | undefined;
  readonly accountsWithQuota: number;
  readonly accountsWithSnapshots: number;
  readonly accountsWithStaleSnapshots: number;
  readonly accountsWithExposedWindows: number;
}

/** Average account figures without allowing stale or missing accounts to skew the result. */
export function summarizeAntigravityQuota(
  accounts: ReadonlyArray<QuotaAggregationAccount>,
  nowMs: number,
): AntigravityQuotaSummary {
  const accountRemaining: number[] = [];
  let accountsWithSnapshots = 0;
  let accountsWithStaleSnapshots = 0;
  let accountsWithExposedWindows = 0;

  for (const account of accounts) {
    const snapshot = account.snapshot;
    if (!snapshot) continue;
    accountsWithSnapshots += 1;

    if (isQuotaSnapshotStale(snapshot, nowMs)) {
      accountsWithStaleSnapshots += 1;
      continue;
    }

    if (snapshot.groups.some((group) => group.windows.length > 0)) {
      accountsWithExposedWindows += 1;
    }

    const remaining = accountQuotaRemainingPercent(snapshot, nowMs);
    if (remaining !== undefined) accountRemaining.push(remaining);
  }

  return {
    averageRemainingPercent:
      accountRemaining.length > 0
        ? Math.round(
            accountRemaining.reduce((sum, remaining) => sum + remaining, 0) /
              accountRemaining.length,
          )
        : undefined,
    accountsWithQuota: accountRemaining.length,
    accountsWithSnapshots,
    accountsWithStaleSnapshots,
    accountsWithExposedWindows,
  };
}
