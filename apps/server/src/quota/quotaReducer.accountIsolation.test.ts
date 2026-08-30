import { describe, expect, it } from "@effect/vitest";

import type { ProviderInstanceId, ProviderRuntimeEvent } from "@t3tools/contracts";

import { applyQuotaEvent, emptyQuotaState } from "./quotaReducer.ts";

const OBSERVED_AT = "2026-08-30T08:00:00.000Z";

function rateLimitEvent(rateLimits: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    type: "account.rate-limits.updated",
    payload: { rateLimits },
  } as unknown as ProviderRuntimeEvent;
}

function agyEvent(groups: ReadonlyArray<Record<string, unknown>>): ProviderRuntimeEvent {
  return rateLimitEvent({ pools: groups });
}

function agyPool(id: string, usedPercent: number): Record<string, unknown> {
  return {
    id,
    name: id === "gemini" ? "Gemini" : "Claude and GPT",
    windows: [{ usedPercent, windowDurationMins: 10_080 }],
  };
}

describe("quota account isolation", () => {
  it("keeps five AGY accounts independent when only AGY-1 has telemetry", () => {
    const accountIds = Array.from(
      { length: 5 },
      (_, index) => `antigravity-${index + 1}` as ProviderInstanceId,
    );

    const state = applyQuotaEvent(emptyQuotaState, {
      providerInstanceId: accountIds[0]!,
      driverKind: "antigravity",
      event: agyEvent([agyPool("gemini", 5), agyPool("claude-gpt", 82)]),
      observedAt: OBSERVED_AT,
    });

    expect(state.size).toBe(1);
    expect(state.get(accountIds[0]!)?.groups).toHaveLength(2);
    for (const accountId of accountIds.slice(1)) {
      expect(state.get(accountId)).toBeUndefined();
    }
  });

  it("does not carry a missing Antigravity pool forward as fresh telemetry", () => {
    const instanceId = "antigravity-1" as ProviderInstanceId;
    const first = applyQuotaEvent(emptyQuotaState, {
      providerInstanceId: instanceId,
      driverKind: "antigravity",
      event: agyEvent([agyPool("gemini", 5), agyPool("claude-gpt", 82)]),
      observedAt: OBSERVED_AT,
    });
    const second = applyQuotaEvent(first, {
      providerInstanceId: instanceId,
      driverKind: "antigravity",
      event: agyEvent([agyPool("gemini", 11)]),
      observedAt: "2026-08-30T08:30:00.000Z",
    });

    expect(second.get(instanceId)?.groups.map((group) => group.key)).toEqual(["gemini"]);
    expect(second.get(instanceId)?.groups[0]?.windows[0]?.usedPercent).toBe(11);
  });

  it("drops a missing Claude weekly window instead of refreshing its old timestamp", () => {
    const instanceId = "claude-1" as ProviderInstanceId;
    const first = applyQuotaEvent(emptyQuotaState, {
      providerInstanceId: instanceId,
      driverKind: "claudeAgent",
      event: rateLimitEvent({
        rate_limits: {
          five_hour: { utilization: 22 },
          seven_day: { utilization: 48 },
        },
      }),
      observedAt: OBSERVED_AT,
    });
    const second = applyQuotaEvent(first, {
      providerInstanceId: instanceId,
      driverKind: "claudeAgent",
      event: rateLimitEvent({ rate_limits: { five_hour: { utilization: 30 } } }),
      observedAt: "2026-08-30T08:30:00.000Z",
    });

    expect(second.get(instanceId)?.groups[0]?.windows).toEqual([
      expect.objectContaining({ kind: "short", usedPercent: 30 }),
    ]);
  });

  it("preserves Codex state across an empty sparse update", () => {
    const instanceId = "codex-1" as ProviderInstanceId;
    const first = applyQuotaEvent(emptyQuotaState, {
      providerInstanceId: instanceId,
      driverKind: "codex",
      event: rateLimitEvent({
        rateLimits: {
          primary: { usedPercent: 40, windowDurationMins: 300 },
          secondary: { usedPercent: 70, windowDurationMins: 10_080 },
        },
      }),
      observedAt: OBSERVED_AT,
    });
    const unchanged = applyQuotaEvent(first, {
      providerInstanceId: instanceId,
      driverKind: "codex",
      event: rateLimitEvent({}),
      observedAt: "2026-08-30T08:30:00.000Z",
    });

    expect(unchanged).toBe(first);
    expect(unchanged.get(instanceId)?.groups[0]?.windows).toHaveLength(2);
  });

  it("clears an old snapshot when a point-in-time provider publishes unusable telemetry", () => {
    const instanceId = "claude-1" as ProviderInstanceId;
    const first = applyQuotaEvent(emptyQuotaState, {
      providerInstanceId: instanceId,
      driverKind: "claudeAgent",
      event: rateLimitEvent({
        rate_limits: { five_hour: { utilization: 22 }, seven_day: { utilization: 48 } },
      }),
      observedAt: OBSERVED_AT,
    });
    const cleared = applyQuotaEvent(first, {
      providerInstanceId: instanceId,
      driverKind: "claudeAgent",
      event: rateLimitEvent({ telemetryUnavailable: true }),
      observedAt: "2026-08-30T08:30:00.000Z",
    });

    expect(cleared.get(instanceId)).toBeUndefined();
  });
});
