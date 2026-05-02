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

import { GeminiCliServerManager } from "../../geminiCliServerManager.ts";
import { makeGeminiCliAdapter } from "./GeminiCliAdapter.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asItemId = (value: string): RuntimeItemId => RuntimeItemId.make(value);

class FakeGeminiManager extends GeminiCliServerManager {
  public startSessionImpl = vi.fn(async (threadId: ThreadId): Promise<ProviderSession> => {
    const now = new Date().toISOString();
    return {
      provider: "geminiCli",
      status: "ready",
      runtimeMode: "full-access",
      threadId,
      cwd: process.cwd(),
      createdAt: now,
      updatedAt: now,
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

it.effect("GeminiCliAdapter delegates startSession", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeGeminiManager();
      const adapter = yield* makeGeminiCliAdapter(enabledConfig, { manager });
      const session = yield* adapter.startSession({
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
      });
      assert.equal(session.provider, "geminiCli");
    }),
  ),
);

it.effect("GeminiCliAdapter rejects attachments", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeGeminiManager();
      const adapter = yield* makeGeminiCliAdapter(enabledConfig, { manager });
      const result = yield* adapter
        .sendTurn({
          threadId: asThreadId("thread-attachments"),
          input: "hi",
          attachments: [{ id: "x" }] as never,
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
    }),
  ),
);

it.effect("GeminiCliAdapter forwards runtime events through the stream", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeGeminiManager();
      const adapter = yield* makeGeminiCliAdapter(enabledConfig, { manager });
      const event = {
        type: "content.delta",
        eventId: asEventId("evt-gemini-delta"),
        provider: "geminiCli",
        createdAt: new Date().toISOString(),
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("item-1"),
        payload: { streamKind: "assistant_text", delta: "hello" },
      } as unknown as ProviderRuntimeEvent;
      manager.emit("event", event);
      const received = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(received._tag, "Some");
    }),
  ),
);

it.effect("GeminiCliAdapter refuses startSession when disabled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeGeminiManager();
      const adapter = yield* makeGeminiCliAdapter({ ...enabledConfig, enabled: false }, { manager });
      const result = yield* adapter
        .startSession({ threadId: asThreadId("t"), runtimeMode: "full-access" })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
    }),
  ),
);
