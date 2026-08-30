// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";

import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { AntigravitySettings } from "@t3tools/contracts/antigravity";

import { ServerConfig } from "../../config.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import { makeAntigravityAdapter } from "./AntigravityAdapter.ts";

const decodeSettings = Schema.decodeSync(AntigravitySettings);
const mockAgentPath = NodePath.resolve("apps/server/scripts/acp-mock-agent.ts");
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-antigravity-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const makeTestAdapter = (environment?: NodeJS.ProcessEnv) =>
  makeAntigravityAdapter(
    decodeSettings({
      enabled: true,
      binaryPath: "agy",
      profileDir: "",
      bridgeCommand: process.execPath,
      bridgeArgs: [mockAgentPath],
      customModels: [],
    }),
    {
      instanceId: ProviderInstanceId.make("antigravity-test"),
      ...(environment ? { environment } : {}),
    },
  ).pipe(Effect.orDie);

it.layer(testLayer)("AntigravityAdapter", (it) => {
  it.effect("maps a bridged ACP prompt into provider runtime events", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-mock-thread");
      const adapter = yield* makeTestAdapter();
      const events: ProviderRuntimeEvent[] = [];
      const completed = yield* Deferred.make<void>();
      const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)).pipe(
          Effect.andThen(
            event.type === "turn.completed" ? Deferred.succeed(completed, undefined) : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("antigravity"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      assert.equal(session.provider, "antigravity");
      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        sessionId: "mock-session-1",
      });

      yield* adapter.sendTurn({ threadId, input: "hello agy", attachments: [] });
      yield* Deferred.await(completed);
      yield* Fiber.interrupt(eventsFiber);

      assert.includeMembers(
        events.map((event) => event.type),
        [
          "session.started",
          "session.state.changed",
          "thread.started",
          "turn.started",
          "content.delta",
          "turn.completed",
        ] as const,
      );
      const delta = events.find((event) => event.type === "content.delta");
      assert.equal(delta?.type, "content.delta");
      if (delta?.type === "content.delta") assert.equal(delta.payload.delta, "hello from mock");
      const sessions = yield* adapter.listSessions();
      assert.equal(sessions[0]?.status, "ready");
      assert.isUndefined(sessions[0]?.activeTurnId);

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("surfaces prompt failures and clears the active turn lifecycle", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-failing-thread");
      const adapter = yield* makeTestAdapter({ ...process.env, T3_ACP_FAIL_PROMPT: "1" });
      const events: ProviderRuntimeEvent[] = [];
      const completed = yield* Deferred.make<void>();
      const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)).pipe(
          Effect.andThen(
            event.type === "turn.completed" ? Deferred.succeed(completed, undefined) : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);

      try {
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("antigravity"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        const error = yield* Effect.flip(
          adapter.sendTurn({ threadId, input: "make a real code change", attachments: [] }),
        );
        yield* Deferred.await(completed);

        assert.match(error.message, /Mock prompt failure/i);
        const terminal = events.find(
          (event) => event.type === "turn.completed" && event.payload.state === "failed",
        );
        assert.equal(terminal?.type, "turn.completed");
        const runtimeError = events.find((event) => event.type === "runtime.error");
        assert.equal(runtimeError?.type, "runtime.error");

        const sessions = yield* adapter.listSessions();
        assert.equal(sessions[0]?.status, "ready");
        assert.isUndefined(sessions[0]?.activeTurnId);
      } finally {
        yield* adapter.stopSession(threadId).pipe(Effect.ignore);
        yield* Fiber.interrupt(eventsFiber);
      }
    }),
  );

  it.effect("cancels a hung prompt and clears active lifecycle state", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("antigravity-cancelled-thread");
      const adapter = yield* makeTestAdapter({ ...process.env, T3_ACP_HANG_PROMPT_FOREVER: "1" });
      const events: ProviderRuntimeEvent[] = [];
      const started = yield* Deferred.make<void>();
      const completed = yield* Deferred.make<void>();
      const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)).pipe(
          Effect.andThen(
            event.type === "turn.started" ? Deferred.succeed(started, undefined) : Effect.void,
          ),
          Effect.andThen(
            event.type === "turn.completed" ? Deferred.succeed(completed, undefined) : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("antigravity"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      const promptFiber = yield* adapter
        .sendTurn({ threadId, input: "long coding task", attachments: [] })
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const [runningSession] = yield* adapter.listSessions();
      assert.equal(runningSession?.status, "running");
      assert.isDefined(runningSession?.activeTurnId);

      yield* adapter.interruptTurn(threadId);
      yield* Deferred.await(completed);
      yield* Fiber.interrupt(promptFiber);
      yield* Fiber.interrupt(eventsFiber);

      const terminalEvents = events.filter((event) => event.type === "turn.completed");
      assert.equal(terminalEvents.length, 1);
      const terminal = terminalEvents[0];
      assert.equal(terminal?.type, "turn.completed");
      if (terminal?.type === "turn.completed") assert.equal(terminal.payload.state, "cancelled");
      const [settledSession] = yield* adapter.listSessions();
      assert.equal(settledSession?.status, "ready");
      assert.isUndefined(settledSession?.activeTurnId);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("keeps structured input unsupported instead of silently dropping it", () =>
    Effect.gen(function* () {
      const adapter = yield* makeTestAdapter();
      const error = yield* Effect.flip(
        adapter.respondToUserInput(
          ThreadId.make("antigravity-no-elicitation"),
          ApprovalRequestId.make("request"),
          {},
        ),
      );
      assert.instanceOf(error, ProviderAdapterRequestError);
      assert.equal(error.detail, "Antigravity ACP does not expose structured user-input requests.");
    }),
  );
});
