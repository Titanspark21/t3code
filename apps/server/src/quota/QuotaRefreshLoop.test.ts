import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { ProviderInstanceId, ProviderRuntimeEvent } from "@t3tools/contracts";
import { QUOTA_CONTRACT_VERSION, type QuotaSummary } from "@t3tools/contracts/quota";

import { makeQuotaRefreshSweep, selectInstancesToRefresh } from "./QuotaRefreshLoop.ts";

const instance = (id: string) => id as ProviderInstanceId;

const summaryWith = (entries: ReadonlyArray<readonly [string, string]>): QuotaSummary => ({
  contractVersion: QUOTA_CONTRACT_VERSION,
  snapshots: entries.map(([id, observedAt]) => ({
    providerInstanceId: instance(id),
    observedAt,
    source: "provider-event" as const,
    groups: [],
  })),
});

const NOW = Date.parse("2026-08-31T12:00:00.000Z");

describe("selectInstancesToRefresh", () => {
  it("refreshes accounts that have never reported", () => {
    expect(
      selectInstancesToRefresh({
        instanceIds: [instance("claude-1"), instance("codex-1")],
        summary: summaryWith([["claude-1", "2026-08-31T11:59:00.000Z"]]),
        now: NOW,
        minimumAgeMs: 600_000,
      }),
    ).toEqual([instance("codex-1")]);
  });

  it("leaves a snapshot alone until it ages past the threshold", () => {
    const summary = summaryWith([["claude-1", "2026-08-31T11:55:00.000Z"]]);
    expect(
      selectInstancesToRefresh({
        instanceIds: [instance("claude-1")],
        summary,
        now: NOW,
        minimumAgeMs: 600_000,
      }),
    ).toEqual([]);

    expect(
      selectInstancesToRefresh({
        instanceIds: [instance("claude-1")],
        summary,
        // Ten minutes later the same snapshot is due, which is the case that
        // used to end with the account quietly ageing out of the panel.
        now: NOW + 300_000,
        minimumAgeMs: 600_000,
      }),
    ).toEqual([instance("claude-1")]);
  });

  it("treats an undateable snapshot as due", () => {
    expect(
      selectInstancesToRefresh({
        instanceIds: [instance("agy-1")],
        summary: summaryWith([["agy-1", "not-a-date"]]),
        now: NOW,
        minimumAgeMs: 600_000,
      }),
    ).toEqual([instance("agy-1")]);
  });
});

describe("makeQuotaRefreshSweep", () => {
  it.effect("keeps refreshing after one instance fails", () =>
    Effect.gen(function* () {
      const attempted: string[] = [];
      yield* makeQuotaRefreshSweep(
        {
          listInstanceIds: Effect.succeed([instance("a"), instance("b")]),
          readSummary: Effect.succeed(summaryWith([])),
          refreshQuota: (id) => {
            attempted.push(String(id));
            return id === instance("a")
              ? Effect.die(new Error("provider exploded"))
              : Effect.succeed([] as ReadonlyArray<ProviderRuntimeEvent>);
          },
        },
        { minimumAgeMs: 0 },
      );
      expect(attempted).toEqual(["a", "b"]);
    }),
  );
});
