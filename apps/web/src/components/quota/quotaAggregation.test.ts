import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { AccountQuotaSnapshot, QuotaGroup } from "@t3tools/contracts/quota";
import { describe, expect, it } from "vite-plus/test";

import {
  accountQuotaRemainingPercent,
  groupQuotaPanelAccounts,
  summarizeAntigravityQuota,
  type QuotaAggregationAccount,
} from "./quotaAggregation";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");

function group(key: string, usedPercent: number): QuotaGroup {
  return {
    key,
    displayName: key,
    windows: [{ kind: "unknown", usedPercent }],
  };
}

function snapshot(
  instanceId: string,
  groups: ReadonlyArray<QuotaGroup>,
  observedAt = "2026-08-27T11:00:00.000Z",
): AccountQuotaSnapshot {
  return {
    providerInstanceId: ProviderInstanceId.make(instanceId),
    groups,
    source: "provider-event",
    observedAt,
  };
}

function account(
  key: string,
  snapshotValue?: AccountQuotaSnapshot,
  displayName = key,
): QuotaAggregationAccount {
  return {
    key,
    instance: { driverKind: ProviderDriverKind.make("antigravity"), displayName },
    snapshot: snapshotValue,
  };
}

describe("quotaAggregation", () => {
  it("collapses the same labeled account across environments", () => {
    const rows = groupQuotaPanelAccounts([
      {
        ...account("windows:claude-1", snapshot("claude-1", [group("Subscription", 40)])),
        instance: { driverKind: ProviderDriverKind.make("claudeAgent"), displayName: "Claude-1" },
      },
      {
        ...account("windows:agy-1", undefined, "AGY-1"),
        instance: { driverKind: ProviderDriverKind.make("antigravity"), displayName: "AGY-1" },
      },
      {
        ...account(
          "ubuntu:claude-1",
          snapshot("claude-1", [group("Subscription", 20)], "2026-08-27T11:30:00.000Z"),
        ),
        instance: { driverKind: ProviderDriverKind.make("claudeAgent"), displayName: "Claude-1" },
      },
      {
        ...account("ubuntu:agy-2", undefined, "AGY-2"),
        instance: { driverKind: ProviderDriverKind.make("antigravity"), displayName: "AGY-2" },
      },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.account.instance.displayName)).toEqual([
      "Claude-1",
      "AGY-1",
      "AGY-2",
    ]);
    expect(rows[0]?.account.key).toBe("claudeAgent:claude-1");
    expect(rows[0]?.account.snapshot?.groups[0]?.windows[0]?.usedPercent).toBe(20);
  });

  it("averages each Antigravity account's pools before averaging accounts", () => {
    const first = snapshot("agy-one", [group("Gemini", 20), group("Claude", 60)]);
    const second = snapshot("agy-two", [group("Gemini", 0)]);

    expect(accountQuotaRemainingPercent(first, NOW)).toBe(60);
    expect(
      summarizeAntigravityQuota([account("one", first), account("two", second)], NOW),
    ).toMatchObject({
      averageRemainingPercent: 80,
      accountsWithQuota: 2,
      accountsWithSnapshots: 2,
      accountsWithExposedWindows: 2,
    });
  });

  it("excludes stale accounts from the headline and reports missing data honestly", () => {
    const fresh = snapshot("agy-fresh", [group("Gemini", 50)]);
    const stale = snapshot("agy-stale", [group("Gemini", 0)], "2026-08-26T00:00:00.000Z");
    const empty = snapshot("agy-empty", []);

    expect(
      summarizeAntigravityQuota(
        [account("fresh", fresh), account("stale", stale), account("empty", empty)],
        NOW,
      ),
    ).toMatchObject({
      averageRemainingPercent: 50,
      accountsWithQuota: 1,
      accountsWithSnapshots: 3,
      accountsWithStaleSnapshots: 1,
      accountsWithExposedWindows: 1,
    });
    expect(accountQuotaRemainingPercent(stale, NOW)).toBeUndefined();
    expect(accountQuotaRemainingPercent(empty, NOW)).toBeUndefined();
  });
});
