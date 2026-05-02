/**
 * KiloAdapter — per-instance adapter factory for the fork's Kilo provider.
 *
 * Same captured-closure pattern as `AmpAdapter` / `GeminiCliAdapter`. Wraps
 * `KiloServerManager`, which talks to a Kilo server child process per
 * session.
 *
 * @module provider/Layers/KiloAdapter
 */
import {
  type GenericProviderSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { Effect, Queue, Stream } from "effect";

import { KiloServerManager } from "../../kiloServerManager.ts";
import type { KiloSessionStartInput } from "../../kilo/types.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { makeErrorHelpers } from "./ProviderAdapterUtils.ts";
import { type ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("kilo");
const { toRequestError } = makeErrorHelpers(PROVIDER);

export interface KiloAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly manager?: KiloServerManager;
  readonly makeManager?: () => KiloServerManager;
}

export const makeKiloAdapter = Effect.fn("makeKiloAdapter")(function* (
  config: GenericProviderSettings,
  options: KiloAdapterOptions = {},
) {
  const manager = options.manager ?? options.makeManager?.() ?? new KiloServerManager();
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const listener = (event: ProviderRuntimeEvent) => {
        Effect.runFork(Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid));
      };
      manager.on("event", listener);
      return listener;
    }),
    (listener) =>
      Effect.gen(function* () {
        manager.off("event", listener);
        manager.stopAll();
        yield* Queue.shutdown(runtimeEventQueue);
      }),
  );

  const adapter: ProviderAdapterShape<ProviderAdapterError> = {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession: (input) =>
      Effect.gen(function* () {
        if (!config.enabled) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "Kilo provider is disabled.",
          });
        }
        const binaryPath = config.binaryPath.trim() || "kilo";
        return yield* Effect.tryPromise({
          try: () =>
            manager.startSession({ ...input, kilo: { binaryPath } } as KiloSessionStartInput),
          catch: (cause) => toRequestError(input.threadId, "session/start", cause),
        });
      }),
    sendTurn: (input) => {
      if ((input.attachments?.length ?? 0) > 0) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Kilo attachments are not wired yet.",
          }),
        );
      }
      return Effect.tryPromise({
        try: () => manager.sendTurn(input),
        catch: (cause) => toRequestError(input.threadId, "session/prompt_async", cause),
      });
    },
    interruptTurn: (threadId) =>
      Effect.tryPromise({
        try: () => manager.interruptTurn(threadId),
        catch: (cause) => toRequestError(threadId, "session/abort", cause),
      }),
    respondToRequest: (threadId, requestId, decision) =>
      Effect.tryPromise({
        try: () => manager.respondToRequest(threadId, requestId, decision),
        catch: (cause) => toRequestError(threadId, "permission/reply", cause),
      }),
    respondToUserInput: (threadId, requestId, answers) =>
      Effect.tryPromise({
        try: () => manager.respondToUserInput(threadId, requestId, answers),
        catch: (cause) => toRequestError(threadId, "question/reply", cause),
      }),
    stopSession: (threadId) =>
      Effect.sync(() => {
        manager.stopSession(threadId);
      }),
    listSessions: () => Effect.sync(() => manager.listSessions()),
    hasSession: (threadId) => Effect.sync(() => manager.hasSession(threadId)),
    readThread: (threadId) =>
      Effect.tryPromise({
        try: () => manager.readThread(threadId),
        catch: (cause) => toRequestError(threadId, "session/messages", cause),
      }),
    rollbackThread: (threadId, numTurns) => {
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          }),
        );
      }
      return Effect.tryPromise({
        try: () => manager.rollbackThread(threadId),
        catch: (cause) => toRequestError(threadId, "session/revert", cause),
      });
    },
    stopAll: () =>
      Effect.sync(() => {
        manager.stopAll();
      }),
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  };

  return adapter;
});
