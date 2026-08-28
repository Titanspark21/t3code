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
  };
  readonly snapshot: AccountQuotaSnapshot | undefined;
}

export type QuotaPanelRow<TAccount extends QuotaAggregationAccount> =
  | {
      readonly kind: "account";
      readonly account: TAccount;
    }
  | {
      readonly kind: "antigravity";
      readonly key: "antigravity";
      readonly accounts: ReadonlyArray<TAccount>;
    };

/**
 * Keep one row per ordinary provider, but present all Antigravity instances as
 * one account group. The first Antigravity account determines where the group
 * appears, so the panel remains stable as other providers refresh.
 */
export function groupQuotaPanelAccounts<TAccount extends QuotaAggregationAccount>(
  accounts: ReadonlyArray<TAccount>,
): ReadonlyArray<QuotaPanelRow<TAccount>> {
  const rows: Array<QuotaPanelRow<TAccount>> = [];
  let antigravityAccounts: TAccount[] | undefined;

  for (const account of accounts) {
    if (account.instance.driverKind !== "antigravity") {
      rows.push({ kind: "account", account });
      continue;
    }

    if (antigravityAccounts) {
      antigravityAccounts.push(account);
      continue;
    }

    antigravityAccounts = [account];
    rows.push({ kind: "antigravity", key: "antigravity", accounts: antigravityAccounts });
  }

  return rows;
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
