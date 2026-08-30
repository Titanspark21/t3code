import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { AccountQuotaSnapshot, QuotaGroup } from "@t3tools/contracts/quota";
import { describe, expect, it } from "vite-plus/test";

import {
  antigravityQuotaWindow,
  averageAntigravityQuotaWindow,
  groupQuotaPanelAccounts,
  summarizeAntigravityQuota,
  type QuotaAggregationAccount,
} from "./quotaAggregation";

const NOW = Date.parse("2026-08-30T12:00:00.000Z");

function pool(key: "gemini" | "claude-gpt", usedPercent: number): QuotaGroup {
  return {
    key,
    displayName: key === "gemini" ? "Gemini Models" : "Claude + GPT Models",
    windows: [{ kind: "long", label: "Weekly limit", usedPercent, windowDurationMins: 10_080 }],
  };
}

function snapshot(
  instanceId: string,
  groups: ReadonlyArray<QuotaGroup>,
  observedAt = "2026-08-30T11:00:00.000Z",
): AccountQuotaSnapshot {
  return {
    providerInstanceId: ProviderInstanceId.make(instanceId),
    groups,
    source: "provider-event",
    observedAt,
  };
}

function account(
  index: number,
  snapshotValue: AccountQuotaSnapshot | undefined,
): QuotaAggregationAccount {
  return {
    key: `environment:antigravity-${index}`,
    instance: {
      driverKind: ProviderDriverKind.make("antigravity"),
      displayName: `AGY-${index}`,
    },
    snapshot: snapshotValue,
  };
}

describe("Antigravity multi-account quota honesty", () => {
  it("shows AGY-1's 95%/18% remaining telemetry only on AGY-1", () => {
    const accounts = [
      account(1, snapshot("antigravity-1", [pool("gemini", 5), pool("claude-gpt", 82)])),
      account(2, undefined),
      account(
        3,
        snapshot(
          "antigravity-3",
          [pool("gemini", 5), pool("claude-gpt", 82)],
          "2026-08-29T00:00:00.000Z",
        ),
      ),
      account(4, snapshot("antigravity-4", [])),
      account(5, undefined),
    ];

    const rows = groupQuotaPanelAccounts(accounts);
    expect(rows.map((row) => row.account.instance.displayName)).toEqual([
      "AGY-1",
      "AGY-2",
      "AGY-3",
      "AGY-4",
      "AGY-5",
    ]);

    expect(antigravityQuotaWindow(rows[0]?.account.snapshot, "gemini", NOW)?.usedPercent).toBe(5);
    expect(antigravityQuotaWindow(rows[0]?.account.snapshot, "claude-gpt", NOW)?.usedPercent).toBe(
      82,
    );
    for (const row of rows.slice(1)) {
      expect(antigravityQuotaWindow(row.account.snapshot, "gemini", NOW)).toBeUndefined();
      expect(antigravityQuotaWindow(row.account.snapshot, "claude-gpt", NOW)).toBeUndefined();
    }

    expect(averageAntigravityQuotaWindow(accounts, "gemini", NOW)?.usedPercent).toBe(5);
    expect(averageAntigravityQuotaWindow(accounts, "claude-gpt", NOW)?.usedPercent).toBe(82);
    expect(summarizeAntigravityQuota(accounts, NOW)).toMatchObject({
      accountsWithQuota: 1,
      accountsWithSnapshots: 3,
      accountsWithStaleSnapshots: 1,
      accountsWithExposedWindows: 1,
    });
  });
});
