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

function account(key: string, snapshotValue?: AccountQuotaSnapshot): QuotaAggregationAccount {
  return {
    key,
    instance: { driverKind: ProviderDriverKind.make("antigravity") },
    snapshot: snapshotValue,
  };
}

describe("quotaAggregation", () => {
  it("keeps ordinary rows in place and combines every Antigravity account", () => {
    const rows = groupQuotaPanelAccounts([
      { ...account("codex"), instance: { driverKind: ProviderDriverKind.make("codex") } },
      account("agy-one"),
      {
        ...account("claude"),
        instance: { driverKind: ProviderDriverKind.make("claudeAgent") },
      },
      account("agy-two"),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "account", account: { key: "codex" } });
    expect(rows[1]).toMatchObject({ kind: "antigravity", key: "antigravity" });
    expect(rows[2]).toMatchObject({ kind: "account", account: { key: "claude" } });
    expect(rows[1]?.kind === "antigravity" && rows[1].accounts.map(({ key }) => key)).toEqual([
      "agy-one",
      "agy-two",
    ]);
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
