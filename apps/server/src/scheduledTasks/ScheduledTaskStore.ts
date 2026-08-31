/**
 * Persistence for scheduled tasks.
 *
 * A flat JSON file beside the other environment-owned state, not an
 * orchestration aggregate: a task is configuration for the machine, like
 * provider settings, and nothing about it needs the event log's history or
 * cross-client replay. Runs it produces are ordinary threads, and those *are*
 * event-sourced.
 *
 * Reads are tolerant and writes are whole-file: the list is small, edited by
 * hand at human speed, and a partially applied write would be worse than a
 * rewrite.
 *
 * @module scheduledTasks/ScheduledTaskStore
 */
import {
  ScheduledTask,
  ScheduledTaskId,
  type ScheduledTaskDraft,
  type ScheduledTaskLastRun,
} from "@t3tools/contracts/scheduledTasks";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";

const decodeTask = Schema.decodeUnknownOption(ScheduledTask);
const encodeTask = Schema.encodeSync(ScheduledTask);

export class ScheduledTaskStore extends Context.Service<
  ScheduledTaskStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<ScheduledTask>>;
    /** Create when the draft has no id, otherwise replace that task. */
    readonly save: (draft: ScheduledTaskDraft) => Effect.Effect<ReadonlyArray<ScheduledTask>>;
    readonly remove: (id: ScheduledTaskId) => Effect.Effect<ReadonlyArray<ScheduledTask>>;
    readonly recordRun: (
      id: ScheduledTaskId,
      lastRun: ScheduledTaskLastRun,
    ) => Effect.Effect<ReadonlyArray<ScheduledTask>>;
  }
>()("t3/scheduledTasks/ScheduledTaskStore") {}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  // Identifier generation cannot fail in any way the caller could act on, and
  // a store method that reports "could not make a UUID" would only force every
  // call site to handle an impossible case.
  const randomUUID = crypto.randomUUIDv4.pipe(Effect.orDie);
  const serverConfig = yield* ServerConfig;
  const filePath = path.join(serverConfig.stateDir, "scheduled-tasks.json");

  const loaded = yield* fs.readFileString(filePath).pipe(
    Effect.map((contents) => {
      const parsed: unknown = JSON.parse(contents);
      const tasks = Array.isArray(parsed)
        ? parsed
        : ((parsed as { tasks?: unknown } | null)?.tasks ?? []);
      if (!Array.isArray(tasks)) return [] as ReadonlyArray<ScheduledTask>;
      // One unreadable task must not take the rest of the file with it.
      return tasks.flatMap((task) => {
        const decoded = decodeTask(task);
        return decoded._tag === "Some" ? [decoded.value] : [];
      });
    }),
    Effect.orElseSucceed(() => [] as ReadonlyArray<ScheduledTask>),
  );

  const state = yield* Ref.make<ReadonlyArray<ScheduledTask>>(loaded);

  const persist = (tasks: ReadonlyArray<ScheduledTask>): Effect.Effect<void> =>
    fs
      .writeFileString(
        filePath,
        `${JSON.stringify({ tasks: tasks.map((task) => encodeTask(task)) }, null, 2)}\n`,
      )
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("scheduled-tasks.persist-failed", { filePath, cause }),
        ),
      );

  const commit = (
    next: ReadonlyArray<ScheduledTask>,
  ): Effect.Effect<ReadonlyArray<ScheduledTask>> =>
    Ref.set(state, next).pipe(Effect.andThen(persist(next)), Effect.as(next));

  const save = Effect.fn("ScheduledTaskStore.save")(function* (draft: ScheduledTaskDraft) {
    const now = DateTime.formatIso(yield* DateTime.now);
    const tasks = yield* Ref.get(state);
    const existing = draft.id ? tasks.find((task) => task.id === draft.id) : undefined;
    const task: ScheduledTask = {
      id: existing?.id ?? ScheduledTaskId.make(yield* randomUUID),
      name: draft.name,
      prompt: draft.prompt,
      projectId: draft.projectId,
      targets: draft.targets,
      schedule: draft.schedule,
      enabled: draft.enabled,
      runtimeMode: draft.runtimeMode ?? existing?.runtimeMode ?? "full-access",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      // Run history belongs to the task, not to the edit that changed it.
      ...(existing?.lastRun ? { lastRun: existing.lastRun } : {}),
    };
    return yield* commit(
      existing ? tasks.map((entry) => (entry.id === existing.id ? task : entry)) : [...tasks, task],
    );
  });

  const remove = Effect.fn("ScheduledTaskStore.remove")(function* (id: ScheduledTaskId) {
    const tasks = yield* Ref.get(state);
    if (!tasks.some((task) => task.id === id)) return tasks;
    return yield* commit(tasks.filter((task) => task.id !== id));
  });

  const recordRun = Effect.fn("ScheduledTaskStore.recordRun")(function* (
    id: ScheduledTaskId,
    lastRun: ScheduledTaskLastRun,
  ) {
    const tasks = yield* Ref.get(state);
    if (!tasks.some((task) => task.id === id)) return tasks;
    return yield* commit(tasks.map((task) => (task.id === id ? { ...task, lastRun } : task)));
  });

  return {
    list: Ref.get(state),
    save,
    remove,
    recordRun,
  } satisfies ScheduledTaskStore["Service"];
});

export const layer = Layer.effect(ScheduledTaskStore, make);

/** In-memory store for tests and for contexts with no state directory. */
export const layerTest = Layer.effect(
  ScheduledTaskStore,
  Effect.gen(function* () {
    const state = yield* Ref.make<ReadonlyArray<ScheduledTask>>([]);
    return {
      list: Ref.get(state),
      save: () => Ref.get(state),
      remove: () => Ref.get(state),
      recordRun: () => Ref.get(state),
    } satisfies ScheduledTaskStore["Service"];
  }),
);
