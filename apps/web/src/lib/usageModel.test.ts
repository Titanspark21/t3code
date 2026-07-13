import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { deriveProviderUsageModel, formatUsageResetRelative } from "./usageModel";

function activity(kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    kind,
    payload,
    createdAt: "2026-01-01T00:00:00.000Z",
  } as unknown as OrchestrationThreadActivity;
}

describe("deriveProviderUsageModel", () => {
  it("returns an empty model when there are no activities", () => {
    const model = deriveProviderUsageModel([]);
    expect(model.hasData).toBe(false);
    expect(model.peakUsedPercent).toBeNull();
    expect(model.rateWindows).toHaveLength(0);
  });

  it("combines context window and rate-limit windows and reports the peak", () => {
    const model = deriveProviderUsageModel([
      activity("context-window.updated", { usedTokens: 50_000, maxTokens: 100_000 }),
      activity("account.rate-limits.updated", {
        provider: "codex",
        limits: [
          { window: "5h", usedPercent: 40, resetsAt: "2099-01-01T00:00:00.000Z" },
          { window: "Weekly", usedPercent: 10, resetsAt: "2099-01-08T00:00:00.000Z" },
        ],
      }),
    ]);

    expect(model.hasData).toBe(true);
    expect(model.contextWindow?.usedPercentage).toBe(50);
    const labels = model.rateWindows.map((w) => w.label);
    expect(labels).toContain("5h");
    expect(labels).toContain("Weekly");
    // Peak is the highest utilization across context (50%) and rate windows (40%, 10%).
    expect(model.peakUsedPercent).toBe(50);
  });
});

describe("formatUsageResetRelative", () => {
  it("returns null for missing or past timestamps", () => {
    expect(formatUsageResetRelative(undefined)).toBeNull();
    expect(formatUsageResetRelative("2000-01-01T00:00:00.000Z")).toBeNull();
  });

  it("formats near-future resets compactly", () => {
    const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000 + 60_000).toISOString();
    expect(formatUsageResetRelative(inTwoHours)).toMatch(/^resets in 2h/);
  });
});
