import { describe, expect, it } from "@effect/vitest";

import type { ProviderInstanceId } from "@t3tools/contracts";

import {
  isoFromEpochSeconds,
  mergeQuotaSnapshots,
  normalizeClaudeRateLimits,
  normalizeCodexRateLimits,
} from "./normalizeRateLimits.ts";

const instanceId = "codex-1" as ProviderInstanceId;
const observedAt = "2026-08-14T12:00:00.000Z";

/** Shape of a real `account/rateLimits/updated` notification from Codex. */
function codexPayload(snapshot: Record<string, unknown>) {
  return { rateLimits: { rateLimits: snapshot } };
}

describe("isoFromEpochSeconds", () => {
  it("reads epoch seconds", () => {
    expect(isoFromEpochSeconds(1_775_000_000)).toBe("2026-03-31T23:33:20.000Z");
  });

  it("rejects milliseconds rather than landing in the year 57000", () => {
    expect(isoFromEpochSeconds(1_775_000_000_000)).toBeUndefined();
  });

  it("rejects non-numbers and implausible values", () => {
    expect(isoFromEpochSeconds("soon")).toBeUndefined();
    expect(isoFromEpochSeconds(0)).toBeUndefined();
    expect(isoFromEpochSeconds(Number.NaN)).toBeUndefined();
  });
});

describe("normalizeCodexRateLimits", () => {
  it("reads both windows and classifies them by duration", () => {
    const snapshot = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt,
      payload: codexPayload({
        limitName: "ChatGPT Pro",
        planType: "pro",
        primary: { usedPercent: 42, resetsAt: 1_775_000_000, windowDurationMins: 300 },
        secondary: { usedPercent: 90, resetsAt: 1_775_400_000, windowDurationMins: 10080 },
      }),
    });

    expect(snapshot).toBeDefined();
    expect(snapshot?.planType).toBe("pro");
    expect(snapshot?.source).toBe("provider-event");
    expect(snapshot?.groups[0]?.displayName).toBe("ChatGPT Pro");
    expect(snapshot?.groups[0]?.windows).toEqual([
      {
        kind: "short",
        usedPercent: 42,
        resetsAt: "2026-03-31T23:33:20.000Z",
        windowDurationMins: 300,
      },
      {
        kind: "long",
        usedPercent: 90,
        resetsAt: "2026-04-05T14:40:00.000Z",
        windowDurationMins: 10080,
      },
    ]);
  });

  it("accepts the payload already unwrapped one level", () => {
    const snapshot = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt,
      payload: { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } } },
    });
    expect(snapshot?.groups[0]?.windows[0]?.usedPercent).toBe(10);
  });

  it("keeps a window that has no reset time instead of inventing one", () => {
    const snapshot = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt,
      payload: codexPayload({ primary: { usedPercent: 7, windowDurationMins: 300 } }),
    });
    expect(snapshot?.groups[0]?.windows[0]).toEqual({
      kind: "short",
      usedPercent: 7,
      windowDurationMins: 300,
    });
  });

  it("leaves an undurated window unknown rather than guessing by position", () => {
    const snapshot = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt,
      payload: codexPayload({ primary: { usedPercent: 55 } }),
    });
    expect(snapshot?.groups[0]?.windows[0]?.kind).toBe("unknown");
  });

  it("clamps an over-100 reading without discarding it", () => {
    const snapshot = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt,
      payload: codexPayload({ primary: { usedPercent: 104, windowDurationMins: 300 } }),
    });
    expect(snapshot?.groups[0]?.windows[0]?.usedPercent).toBe(100);
  });

  it("carries the limit-reached reason", () => {
    const snapshot = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt,
      payload: codexPayload({
        rateLimitReachedType: "rate_limit_reached",
        primary: { usedPercent: 100, windowDurationMins: 300 },
      }),
    });
    expect(snapshot?.limitReached).toBe("rate_limit_reached");
  });

  it("returns undefined for an unrecognized payload rather than a zeroed row", () => {
    for (const payload of [null, undefined, 42, "nope", {}, codexPayload({}), { rateLimits: {} }]) {
      expect(
        normalizeCodexRateLimits({ providerInstanceId: instanceId, observedAt, payload }),
      ).toBeUndefined();
    }
  });

  it("drops a window with no percentage instead of showing it at zero", () => {
    const snapshot = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt,
      payload: codexPayload({ primary: { resetsAt: 1_775_000_000, windowDurationMins: 300 } }),
    });
    expect(snapshot).toBeUndefined();
  });
});

describe("normalizeClaudeRateLimits", () => {
  it("reads duration-tagged windows", () => {
    const snapshot = normalizeClaudeRateLimits({
      providerInstanceId: "claude-1" as ProviderInstanceId,
      observedAt,
      payload: {
        rateLimits: {
          five_hour: { usedPercent: 12, resetsAt: 1_775_000_000, windowDurationMins: 300 },
          weekly: { usedPercent: 88, resetsAt: 1_775_400_000, windowDurationMins: 10080 },
        },
      },
    });

    expect(snapshot?.groups[0]?.windows).toHaveLength(2);
    expect(snapshot?.groups[0]?.windows[0]?.label).toBe("5-hour limit");
    expect(snapshot?.groups[0]?.windows[1]?.kind).toBe("long");
  });

  it("reads a plain list of windows", () => {
    const snapshot = normalizeClaudeRateLimits({
      providerInstanceId: "claude-1" as ProviderInstanceId,
      observedAt,
      payload: { windows: [{ usedPercent: 30, windowDurationMins: 300 }] },
    });
    expect(snapshot?.groups[0]?.windows[0]?.usedPercent).toBe(30);
  });

  it("returns undefined on an unrecognized shape so the row reads 'not exposed'", () => {
    expect(
      normalizeClaudeRateLimits({
        providerInstanceId: "claude-1" as ProviderInstanceId,
        observedAt,
        payload: { type: "rate_limit_event", somethingNew: { pct: 50 } },
      }),
    ).toBeUndefined();
  });
});

describe("mergeQuotaSnapshots", () => {
  const base = normalizeCodexRateLimits({
    providerInstanceId: instanceId,
    observedAt,
    payload: codexPayload({
      primary: { usedPercent: 40, windowDurationMins: 300 },
      secondary: { usedPercent: 80, windowDurationMins: 10080 },
    }),
  })!;

  it("does not let a sparse update erase the window it omitted", () => {
    const sparse = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt: "2026-08-14T12:05:00.000Z",
      payload: codexPayload({ primary: { usedPercent: 55, windowDurationMins: 300 } }),
    })!;

    const merged = mergeQuotaSnapshots(base, sparse);
    const windows = merged.groups[0]!.windows;
    expect(windows).toHaveLength(2);
    expect(windows.find((w) => w.kind === "short")?.usedPercent).toBe(55);
    expect(windows.find((w) => w.kind === "long")?.usedPercent).toBe(80);
  });

  it("clears a stale limit-reached rather than carrying it past the reset", () => {
    const limited = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt,
      payload: codexPayload({
        rateLimitReachedType: "rate_limit_reached",
        primary: { usedPercent: 100, windowDurationMins: 300 },
      }),
    })!;
    const recovered = normalizeCodexRateLimits({
      providerInstanceId: instanceId,
      observedAt: "2026-08-14T17:00:00.000Z",
      payload: codexPayload({ primary: { usedPercent: 3, windowDurationMins: 300 } }),
    })!;

    expect(mergeQuotaSnapshots(limited, recovered).limitReached).toBeUndefined();
  });

  it("replaces wholesale when the instance differs", () => {
    const other = { ...base, providerInstanceId: "codex-2" as ProviderInstanceId };
    expect(mergeQuotaSnapshots(base, other)).toBe(other);
  });
});
