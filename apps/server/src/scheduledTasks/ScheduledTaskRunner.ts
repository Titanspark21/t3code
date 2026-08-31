/**
 * Fires scheduled tasks and keeps their runs out of the way.
 *
 * A run is deliberately an ordinary thread started by an ordinary
 * `thread.turn.start`: the same path a person's message takes, so provider
 * routing, checkpointing and history all work without a parallel code path.
 * The only difference is what happens afterwards — the runner settles the
 * thread once its turn goes quiet, so a scheduled run does not accumulate in
 * the active list. Settling has to wait for the turn to finish because a
 * session coming alive un-settles a thread by design.
 *
 * A run that needs a person still surfaces: an approval or user-input request
 * un-settles the thread through the normal rules, which is the behaviour we
 * want — silent automation must not swallow a blocked agent.
 *
 * @module scheduledTasks/ScheduledTaskRunner
 */
import { CommandId, MessageId, ThreadId, type ProviderInstanceId } from "@t3tools/contracts";
import {
  isScheduledTaskDue,
  type ScheduledTask,
  type ScheduledTaskId,
  type ScheduledTaskRunOutcome,
} from "@t3tools/contracts/scheduledTasks";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ScheduledTaskStore } from "./ScheduledTaskStore.ts";

/**
 * How often due tasks are looked for.
 *
 * A minute is the resolution a `HH:MM` schedule promises, and the check is a
 * pure comparison over a handful of records.
 */
export const SCHEDULED_TASK_TICK_MS = 30_000;

export class ScheduledTaskRunner extends Context.Service<
  ScheduledTaskRunner,
  {
    /** Run a task by id, ignoring its schedule. */
    readonly runNow: (id: ScheduledTaskId) => Effect.Effect<void>;
    /** The scheduler itself. Fork it; it never completes. */
    readonly loop: Effect.Effect<void>;
  }
>()("t3/scheduledTasks/ScheduledTaskRunner") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4.pipe(Effect.orDie);
  const store = yield* ScheduledTaskStore;

  /** Threads started by a run, waiting for their turn to go quiet. */
  const pendingSettles = new Set<ThreadId>();

  /**
   * Start one target's thread. Returns the thread it created, or `undefined`
   * when dispatch failed — one bad account must not stop the others.
   */
  const startTarget = Effect.fn("ScheduledTaskRunner.startTarget")(function* (input: {
    readonly task: ScheduledTask;
    readonly target: ScheduledTask["targets"][number];
  }) {
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const threadId = ThreadId.make(yield* randomUUID);
    const modelSelection = {
      instanceId: input.target.instanceId,
      model: input.target.model,
    };

    const dispatched = yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`scheduled:${yield* randomUUID}`),
        threadId,
        message: {
          messageId: MessageId.make(yield* randomUUID),
          role: "user",
          text: input.task.prompt,
          attachments: [],
        },
        modelSelection,
        titleSeed: input.task.name,
        runtimeMode: input.task.runtimeMode,
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: input.task.projectId,
            title: input.task.name,
            modelSelection,
            runtimeMode: input.task.runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      })
      .pipe(
        Effect.as(threadId),
        Effect.catchCause((cause) =>
          Effect.logWarning("scheduled-tasks.start-failed", {
            taskId: input.task.id,
            instanceId: input.target.instanceId,
            cause,
          }).pipe(Effect.as(undefined)),
        ),
      );

    if (dispatched) pendingSettles.add(dispatched);
    return dispatched;
  });

  /** Run every target of one task and record what happened. */
  const runTask = Effect.fn("ScheduledTaskRunner.runTask")(function* (task: ScheduledTask) {
    const startedTargets: Array<ProviderInstanceId> = [];

    for (const target of task.targets) {
      const threadId = yield* startTarget({ task, target });
      if (threadId) startedTargets.push(target.instanceId);
    }

    const outcome: ScheduledTaskRunOutcome =
      task.targets.length === 0 ? "skipped" : startedTargets.length > 0 ? "started" : "failed";
    const detail =
      outcome === "started" && startedTargets.length < task.targets.length
        ? `${task.targets.length - startedTargets.length} target(s) failed to start`
        : outcome === "skipped"
          ? "no targets configured"
          : undefined;

    yield* store.recordRun(task.id, {
      at: DateTime.formatIso(yield* DateTime.now),
      outcome,
      startedTargets,
      ...(detail ? { detail } : {}),
    });
  });

  const runNow = Effect.fn("ScheduledTaskRunner.runNow")(function* (id: ScheduledTaskId) {
    const task = (yield* store.list).find((candidate) => candidate.id === id);
    if (!task) return;
    yield* Effect.logInfo("scheduled-tasks.run-now", { taskId: task.id });
    yield* runTask(task);
  });

  const tick = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const due = (yield* store.list).filter((task) => isScheduledTaskDue(task, now));
    for (const task of due) {
      yield* Effect.logInfo("scheduled-tasks.firing", { taskId: task.id, name: task.name });
      yield* runTask(task);
    }
  });

  /**
   * Settle the threads a run created, once their turn is over.
   *
   * The signal is the thread's session going quiet — no active turn, and a
   * status that is not starting or running. Settling any earlier is pointless:
   * the decider un-settles a thread whose session comes alive.
   */
  const settleFinishedRuns = Stream.runForEach(engine.streamDomainEvents, (event) =>
    Effect.gen(function* () {
      if (event.type !== "thread.session-set") return;
      const { threadId, session } = event.payload;
      if (!pendingSettles.has(threadId)) return;
      if (session.activeTurnId !== null) return;
      if (session.status === "starting" || session.status === "running") return;

      pendingSettles.delete(threadId);
      yield* engine
        .dispatch({
          type: "thread.settle",
          commandId: CommandId.make(`scheduled-settle:${yield* randomUUID}`),
          threadId,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("scheduled-tasks.settle-failed", { threadId, cause }),
          ),
        );
    }),
  );

  const loop = Effect.all(
    [
      tick.pipe(
        Effect.catchCause((cause) => Effect.logWarning("scheduled-tasks.tick-failed", { cause })),
        Effect.repeat(Schedule.spaced(Duration.millis(SCHEDULED_TASK_TICK_MS))),
      ),
      settleFinishedRuns.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("scheduled-tasks.settle-stream-failed", { cause }),
        ),
      ),
    ],
    { concurrency: "unbounded", discard: true },
  );

  return ScheduledTaskRunner.of({ runNow, loop });
});

export const layer = Layer.effect(ScheduledTaskRunner, make);

/** Runner that does nothing, for contexts that never fire a task. */
export const layerTest = Layer.succeed(
  ScheduledTaskRunner,
  ScheduledTaskRunner.of({ runNow: () => Effect.void, loop: Effect.void }),
);
