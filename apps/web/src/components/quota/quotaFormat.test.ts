import { describe, expect, it } from "vite-plus/test";

import {
  formatQuotaAge,
  formatQuotaReset,
  formatQuotaResetAtGlance,
  quotaRemainingPercent,
  quotaWindowLabel,
} from "./quotaFormat";

describe("quotaFormat", () => {
  it("shows remaining quota rather than used quota", () => {
    expect(quotaRemainingPercent(64.4)).toBe(36);
    expect(quotaRemainingPercent(0)).toBe(100);
    expect(quotaRemainingPercent(140)).toBe(0);
  });

  it("uses normalized window names", () => {
    expect(quotaWindowLabel({ kind: "short", usedPercent: 1 })).toBe("5h");
    expect(quotaWindowLabel({ kind: "long", usedPercent: 1 })).toBe("Week");
    expect(quotaWindowLabel({ kind: "unknown", label: "Fable", usedPercent: 1 })).toBe("Fable");
  });

  it("formats reset and stale ages on a coarse clock", () => {
    const now = Date.parse("2026-08-23T12:00:00.000Z");
    expect(formatQuotaReset("2026-08-23T13:30:00.000Z", now)).toBe("Resets in 1h");
    expect(formatQuotaResetAtGlance("2026-08-23T12:30:00.000Z", now, "short")).toBe("in 30m");
    expect(formatQuotaResetAtGlance("2026-08-28T04:24:00.000Z", now, "long")).toMatch(/:/);
    expect(formatQuotaResetAtGlance(undefined, now, "long")).toBe("reset n/a");
    expect(formatQuotaAge("2026-08-23T04:00:00.000Z", now)).toBe("8h old");
  });
});
