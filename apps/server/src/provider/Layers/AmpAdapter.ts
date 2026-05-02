/**
 * AmpAdapter — per-instance adapter factory for the fork's Amp provider.
 *
 * Wraps the existing Node-EventEmitter `AmpServerManager` (which still owns
 * all the JSONL protocol parsing and child-process management) into a value
 * matching `ProviderAdapterShape`. One adapter, one manager, one
 * unbounded runtime-event queue — all captured in the closures returned
 * here.
 *
 * The pre-sync code held a singleton `AmpAdapter` Service tag that fanned
 * config in via `ServerSettingsService`. Per-instance drivers can't share a
 * singleton, so this module resolves config from the typed
 * `GenericProviderSettings` argument instead. Two driver instances therefore
 * mean two manager processes with independent `binaryPath` and `configDir`.
 *
 * @module provider/Layers/AmpAdapter
 */
import {
  type GenericProviderSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { Effect, Queue, Stream } from "effect";

import { AmpServerManager } from "../../ampServerManager.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { makeErrorHelpers } from "./ProviderAdapterUtils.ts";
import { type ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("amp");
const { toRequestError } = makeErrorHelpers(PROVIDER);

export interface AmpAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly manager?: AmpServerManager;
  readonly makeManager?: () => AmpServerManager;
}

/**
 * Construct an Amp adapter bound to a single configuration. Returns an
 * Effect that runs in a `Scope`; closing the scope detaches the manager
 * listener and stops every session it owns.
 */
export const makeAmpAdapter = Effect.fn("makeAmpAdapter")(function* (
  config: GenericProviderSettings,
  options: AmpAdapterOptions = {},
) {
  const manager = options.manager ?? options.makeManager?.() ?? new AmpServerManager();
  // Apply per-instance binary path. The manager re-reads this on every
  // `startSession` so changes propagate without a restart.
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
            issue: "Amp provider is disabled.",
          });
        }
        // Refresh binary path from current config in case the driver
        // recreated us from updated settings.
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
            issue: "AMP attachments are not supported yet.",
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
