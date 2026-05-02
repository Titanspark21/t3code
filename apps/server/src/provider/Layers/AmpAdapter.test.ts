import assert from "node:assert/strict";

import {
  EventId,
  GenericProviderSettings,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
} from "@t3tools/contracts";
import { it, vi } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";

import { AmpServerManager } from "../../ampServerManager.ts";
import { makeAmpAdapter } from "./AmpAdapter.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asItemId = (value: string): RuntimeItemId => RuntimeItemId.make(value);

class FakeAmpManager extends AmpServerManager {
  public startSessionImpl = vi.fn(async (threadId: ThreadId): Promise<ProviderSession> => {
    const now = new Date().toISOString();
    return {
      provider: "amp",
      status: "ready",
      runtimeMode: "full-access",
      threadId,
      cwd: process.cwd(),
      createdAt: now,
      updatedAt: now,
      resumeCursor: { sessionId: `session-${threadId}` },
    } as unknown as ProviderSession;
  });

  public sendTurnImpl = vi.fn(
    async (threadId: ThreadId): Promise<ProviderTurnStartResult> => ({
      threadId,
      turnId: asTurnId(`turn-${threadId}`),
    }),
  );

  override startSession(input: { threadId: ThreadId }): Promise<ProviderSession> {
    return this.startSessionImpl(input.threadId);
  }

  override sendTurn(input: { threadId: ThreadId }): Promise<ProviderTurnStartResult> {
    return this.sendTurnImpl(input.threadId);
  }

  override stopSession(_threadId: ThreadId): void {}
  override listSessions(): ProviderSession[] {
    return [];
  }
  override hasSession(_threadId: ThreadId): boolean {
    return false;
  }
  override stopAll(): void {}
}

const enabledConfig = Schema.decodeSync(GenericProviderSettings)({});

it.effect("AmpAdapter delegates startSession to its AmpServerManager", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeAmpManager();
      const adapter = yield* makeAmpAdapter(enabledConfig, { manager });
      const session = yield* adapter.startSession({
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
      });
      assert.equal(session.provider, "amp");
      assert.equal(manager.startSessionImpl.mock.calls[0]?.[0], asThreadId("thread-1"));
    }),
  ),
);

it.effect("AmpAdapter rejects attachments until wiring exists", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeAmpManager();
      const adapter = yield* makeAmpAdapter(enabledConfig, { manager });
      const result = yield* adapter
        .sendTurn({
          threadId: asThreadId("thread-attachments"),
          input: "hello",
          attachments: [{ id: "attachment-1" }] as never,
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") return;
      assert.equal(result.failure._tag, "ProviderAdapterValidationError");
    }),
  ),
);

it.effect("AmpAdapter forwards manager runtime events through the stream", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeAmpManager();
      const adapter = yield* makeAmpAdapter(enabledConfig, { manager });
      const event = {
        type: "content.delta",
        eventId: asEventId("evt-amp-delta"),
        provider: "amp",
        createdAt: new Date().toISOString(),
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("item-1"),
        payload: {
          streamKind: "assistant_text",
          delta: "hello",
        },
      } as unknown as ProviderRuntimeEvent;
      manager.emit("event", event);
      const received = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(received._tag, "Some");
      if (received._tag !== "Some") return;
      assert.equal(received.value.type, "content.delta");
    }),
  ),
);

it.effect("AmpAdapter refuses startSession when the config is disabled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeAmpManager();
      const disabled = { ...enabledConfig, enabled: false };
      const adapter = yield* makeAmpAdapter(disabled, { manager });
      const result = yield* adapter
        .startSession({
          threadId: asThreadId("thread-disabled"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") return;
      assert.equal(result.failure._tag, "ProviderAdapterValidationError");
    }),
  ),
);
