import {
  isQuotaSnapshotStale,
  primaryQuotaWindow,
  type AccountQuotaSnapshot,
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
