/**
 * GeminiCliAdapter — per-instance adapter factory for the fork's Gemini CLI provider.
 *
 * Same pattern as `AmpAdapter`: wrap the existing Node-EventEmitter
 * `GeminiCliServerManager` into a `ProviderAdapterShape` value bound to one
 * `GenericProviderSettings` config. Multi-instance safe — each driver
 * `create()` call constructs its own manager.
 *
 * @module provider/Layers/GeminiCliAdapter
 */
import {
  type GenericProviderSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { Effect, Queue, Stream } from "effect";

import { GeminiCliServerManager } from "../../geminiCliServerManager.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { makeErrorHelpers } from "./ProviderAdapterUtils.ts";
import { type ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("geminiCli");
const { toRequestError } = makeErrorHelpers(PROVIDER, {
  sessionNotFoundHints: ["unknown gemini cli session", "unknown session"],
});

export interface GeminiCliAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly manager?: GeminiCliServerManager;
  readonly makeManager?: () => GeminiCliServerManager;
}

export const makeGeminiCliAdapter = Effect.fn("makeGeminiCliAdapter")(function* (
  config: GenericProviderSettings,
  options: GeminiCliAdapterOptions = {},
) {
  const manager = options.manager ?? options.makeManager?.() ?? new GeminiCliServerManager();
  manager.binaryPath = config.binaryPath.trim() || undefined;

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
            issue: "Gemini CLI provider is disabled.",
          });
        }
        manager.binaryPath = config.binaryPath.trim() || undefined;
        return yield* Effect.tryPromise({
          try: () => manager.startSession(input),
          catch: (cause) => toRequestError(input.threadId, "session/start", cause),
        });
      }),
    sendTurn: (input) => {
      if ((input.attachments?.length ?? 0) > 0) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Gemini CLI attachments are not supported yet.",
          }),
        );
      }
      return Effect.tryPromise({
        try: () => manager.sendTurn(input),
        catch: (cause) => toRequestError(input.threadId, "session/prompt", cause),
      });
    },
    interruptTurn: (threadId) =>
      Effect.tryPromise({
        try: () => manager.interruptTurn(threadId),
        catch: (cause) => toRequestError(threadId, "session/interrupt", cause),
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
