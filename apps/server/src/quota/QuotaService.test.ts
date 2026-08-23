import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { Effect, Stream } from "effect";
import * as Fiber from "effect/Fiber";
import { describe, expect, it } from "vite-plus/test";

import { QuotaService, layer } from "./QuotaService.ts";

const quotaEvent = (
  usedPercent: number,
  providerInstanceId: ProviderInstanceId = ProviderInstanceId.make("codex_work"),
): ProviderRuntimeEvent => ({
  type: "account.rate-limits.updated",
  eventId: EventId.make(`quota-${usedPercent}`),
  provider: ProviderDriverKind.make("codex"),
  providerInstanceId,
  threadId: ThreadId.make("thread-1"),
  createdAt: "2026-08-23T12:00:00.000Z",
  payload: {
    rateLimits: {
      rateLimits: {
        primary: {
          usedPercent,
          windowDurationMins: 300,
        },
      },
    },
  },
});

describe("QuotaService", () => {
  it("uses a cold-start seed until a newer live snapshot arrives", async () => {
    const summary = await Effect.gen(function* () {
      const service = yield* QuotaService;
      yield* service.seedSnapshot({
        providerInstanceId: ProviderInstanceId.make("codex_work"),
        groups: [
          {
            key: "default",
            displayName: "Subscription",
            windows: [{ kind: "short", usedPercent: 18 }],
          },
        ],
        source: "state-file",
        observedAt: "2026-08-22T12:00:00.000Z",
      });
      yield* service.ingest(quotaEvent(42));
      return yield* service.readSummary;
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(summary.snapshots[0]?.source).toBe("provider-event");
    expect(summary.snapshots[0]?.groups[0]?.windows[0]?.usedPercent).toBe(42);
  });

  it("stores snapshots by provider instance", async () => {
    const summary = await Effect.gen(function* () {
      const service = yield* QuotaService;
      yield* service.ingest(quotaEvent(42));
      return yield* service.readSummary;
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(summary.snapshots).toHaveLength(1);
    expect(summary.snapshots[0]?.providerInstanceId).toBe("codex_work");
    expect(summary.snapshots[0]?.groups[0]?.windows[0]?.usedPercent).toBe(42);
  });

  it("serializes concurrent updates without losing an account", async () => {
    const summary = await Effect.gen(function* () {
      const service = yield* QuotaService;
      yield* Effect.all(
        [
          service.ingest(quotaEvent(31, ProviderInstanceId.make("codex_work"))),
          service.ingest(quotaEvent(64, ProviderInstanceId.make("codex_personal"))),
        ],
        { concurrency: "unbounded" },
      );
      return yield* service.readSummary;
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(summary.snapshots.map((snapshot) => snapshot.providerInstanceId)).toEqual([
      "codex_personal",
      "codex_work",
    ]);
  });

  it("does not publish for unrelated runtime events", async () => {
    const summaries = await Effect.gen(function* () {
      const service = yield* QuotaService;
      const fiber = yield* service.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* service.ingest({
        type: "content.delta",
        eventId: EventId.make("assistant-delta"),
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex_work"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-08-23T12:00:00.000Z",
        payload: { streamKind: "assistant_text", delta: "hello" },
      });
      yield* service.ingest(quotaEvent(43));
      return Array.from(yield* Fiber.join(fiber));
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.snapshots).toEqual([]);
    expect(summaries[1]?.snapshots[0]?.groups[0]?.windows[0]?.usedPercent).toBe(43);
  });
});
