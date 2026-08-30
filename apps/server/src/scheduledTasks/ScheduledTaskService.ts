import {
  CommandId,
  MessageId,
  type OrchestrationThreadShell,
  ScheduledTask,
  ScheduledTaskError,
  ScheduledTaskId,
  ScheduledTaskRun,
  SCHEDULED_TASK_THREAD_PREFIX,
  ThreadId,
  type ScheduledTaskDeleteInput,
  type ScheduledTaskDeleteResult,
  type ScheduledTaskListResult,
  type ScheduledTaskMutationResult,
  type ScheduledTaskRunNowInput,
  type ScheduledTaskRunNowResult,
  type ScheduledTaskSetEnabledInput,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  isMissedFixedTimeRun,
  isSameSchedule,
  isValidTimeZone,
  nextScheduledRunAt,
} from "./Schedule.ts";

const POLL_INTERVAL = Duration.seconds(5);
const THREAD_POLL_INTERVAL = Duration.seconds(2);
const THREAD_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const HISTORY_LIMIT = 100;
const DEFAULT_MAX_RETRIES = 2;

const decodeTask = Schema.decodeUnknownEffect(ScheduledTask);
const decodeRun = Schema.decodeUnknownEffect(ScheduledTaskRun);
const decodeScheduleJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ScheduledTask.fields.schedule),
);
const decodeModelSelectionJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ScheduledTask.fields.modelSelection),
);

interface ScheduledTaskRow {
  readonly task_id: string;
  readonly title: string;
  readonly prompt: string;
  readonly enabled: number;
  readonly schedule_json: string;
  readonly project_id: string;
  readonly model_selection_json: string;
  readonly runtime_mode: string;
  readonly interaction_mode: string;
  readonly max_retries: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly next_run_at: string | null;
  readonly last_run_at: string | null;
  readonly last_run_status: string;
  readonly last_run_error: string | null;
  readonly run_count: number;
}

interface ScheduledTaskRunRow {
  readonly run_id: string;
  readonly task_id: string;
  readonly trigger: string;
  readonly status: string;
  readonly scheduled_for: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly attempt_count: number;
  readonly thread_id: string | null;
  readonly error: string | null;
}

interface AttemptResult {
  readonly succeeded: boolean;
  readonly retryable: boolean;
  readonly threadId: ThreadId | null;
  readonly error: string | null;
}

export class ScheduledTaskService extends Context.Service<
  ScheduledTaskService,
  {
    /** Starts restart recovery and the due-task poller in the supplied server runtime scope. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    readonly list: () => Effect.Effect<ScheduledTaskListResult, ScheduledTaskError>;
    readonly subscribeList: () => Stream.Stream<ScheduledTaskListResult, ScheduledTaskError>;
    readonly upsert: (
      input: ScheduledTaskUpsertInput,
    ) => Effect.Effect<ScheduledTaskMutationResult, ScheduledTaskError>;
    readonly setEnabled: (
      input: ScheduledTaskSetEnabledInput,
    ) => Effect.Effect<ScheduledTaskMutationResult, ScheduledTaskError>;
    readonly delete: (
      input: ScheduledTaskDeleteInput,
    ) => Effect.Effect<ScheduledTaskDeleteResult, ScheduledTaskError>;
    readonly runNow: (
      input: ScheduledTaskRunNowInput,
    ) => Effect.Effect<ScheduledTaskRunNowResult, ScheduledTaskError>;
  }
>()("t3/scheduledTasks/ScheduledTaskService") {}

function taskError(message: string, input?: { taskId?: ScheduledTaskId; cause?: unknown }) {
  return new ScheduledTaskError({
    message,
    ...(input?.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input?.cause === undefined ? {} : { cause: input.cause }),
  });
}

function errorMessage(error: unknown): string {
  if (Cause.isCause(error)) return Cause.pretty(error);
  if (error instanceof Error) return error.message;
  return String(error);
}

function iso(value: DateTime.DateTime): string {
  return DateTime.formatIso(DateTime.toUtc(value));
}

function automationPrompt(task: ScheduledTask): string {
  return `[Scheduled task: ${task.title}]\n\n${task.prompt}`;
}

export function isRestartInterruptedBeforeTurn(
  thread: Pick<OrchestrationThreadShell, "latestTurn" | "session" | "backgroundLiveness">,
): boolean {
  const sessionBusy = thread.session?.status === "starting" || thread.session?.status === "running";
  return thread.latestTurn === null && !sessionBusy && (thread.backgroundLiveness ?? null) === null;
}

function nextRunAt(
  task: Pick<ScheduledTask, "enabled" | "schedule">,
  from: DateTime.DateTime,
): string | null {
  if (!task.enabled) return null;
  const next = nextScheduledRunAt(task.schedule, from);
  return next === null ? null : iso(next);
}

const decodeTaskRow = (row: ScheduledTaskRow) =>
  Effect.gen(function* () {
    const schedule = yield* decodeScheduleJson(row.schedule_json);
    const modelSelection = yield* decodeModelSelectionJson(row.model_selection_json);
    return yield* decodeTask({
      id: ScheduledTaskId.make(row.task_id),
      title: row.title,
      prompt: row.prompt,
      enabled: row.enabled === 1,
      schedule,
      projectId: row.project_id,
      modelSelection,
      runtimeMode: row.runtime_mode,
      interactionMode: row.interaction_mode,
      maxRetries: row.max_retries,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      lastRunStatus: row.last_run_status,
      lastRunError: row.last_run_error,
      runCount: row.run_count,
    });
  }).pipe(
    Effect.mapError((cause) =>
      taskError("Could not decode scheduled task row.", {
        taskId: ScheduledTaskId.make(row.task_id),
        cause,
      }),
    ),
  );

const decodeRunRow = (row: ScheduledTaskRunRow) =>
  decodeRun({
    id: row.run_id,
    taskId: row.task_id,
    trigger: row.trigger,
    status: row.status,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    attemptCount: row.attempt_count,
    threadId: row.thread_id,
    error: row.error,
  }).pipe(
    Effect.mapError((cause) =>
      taskError("Could not decode scheduled task history row.", {
        taskId: ScheduledTaskId.make(row.task_id),
        cause,
      }),
    ),
  );

export const layer = Layer.effect(
  ScheduledTaskService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const activeRuns = yield* Ref.make<ReadonlySet<ScheduledTaskId>>(new Set());
    const started = yield* Ref.make(false);
    const changesPubSub = yield* PubSub.sliding<void>(1);
    const notifyChanged = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);
    const randomUuid = crypto.randomUUIDv4.pipe(
      Effect.mapError((cause) =>
        taskError("Could not generate scheduled task identifier.", { cause }),
      ),
    );

    const selectAllRows = () => sql<ScheduledTaskRow>`
      SELECT
        task_id,
        title,
        prompt,
        enabled,
        schedule_json,
        project_id,
        model_selection_json,
        runtime_mode,
        interaction_mode,
        max_retries,
        created_at,
        updated_at,
        next_run_at,
        last_run_at,
        last_run_status,
        last_run_error,
        run_count
      FROM scheduled_tasks
      ORDER BY updated_at DESC, task_id ASC
    `;

    const selectHistoryRows = () => sql<ScheduledTaskRunRow>`
      SELECT
        run_id,
        task_id,
        trigger,
        status,
        scheduled_for,
        started_at,
        completed_at,
        attempt_count,
        thread_id,
        error
      FROM scheduled_task_runs
      ORDER BY started_at DESC, run_id DESC
      LIMIT ${HISTORY_LIMIT}
    `;

    const selectRunningHistoryRows = () => sql<ScheduledTaskRunRow>`
      SELECT
        run_id,
        task_id,
        trigger,
        status,
        scheduled_for,
        started_at,
        completed_at,
        attempt_count,
        thread_id,
        error
      FROM scheduled_task_runs
      WHERE status = 'running'
      ORDER BY started_at ASC, run_id ASC
    `;

    const getRows = (id: ScheduledTaskId) => sql<ScheduledTaskRow>`
      SELECT
        task_id,
        title,
        prompt,
        enabled,
        schedule_json,
        project_id,
        model_selection_json,
        runtime_mode,
        interaction_mode,
        max_retries,
        created_at,
        updated_at,
        next_run_at,
        last_run_at,
        last_run_status,
        last_run_error,
        run_count
      FROM scheduled_tasks
      WHERE task_id = ${id}
    `;

    const listRows = Effect.fn("ScheduledTaskService.listRows")(function* () {
      const rows = yield* selectAllRows().pipe(
        Effect.mapError((cause) => taskError("Could not list scheduled tasks.", { cause })),
      );
      return yield* Effect.forEach(rows, decodeTaskRow, { concurrency: 1 });
    });

    const listRuns = Effect.fn("ScheduledTaskService.listRuns")(function* () {
      const rows = yield* selectHistoryRows().pipe(
        Effect.mapError((cause) => taskError("Could not list scheduled task history.", { cause })),
      );
      return yield* Effect.forEach(rows, decodeRunRow, { concurrency: 1 });
    });

    const listTasksLenient = Effect.fn("ScheduledTaskService.listTasksLenient")(function* () {
      const rows = yield* selectAllRows();
      const tasks: ScheduledTask[] = [];
      for (const row of rows) {
        const decoded = yield* Effect.result(decodeTaskRow(row));
        if (Result.isSuccess(decoded)) {
          tasks.push(decoded.success);
        } else {
          yield* Effect.logWarning("Skipping undecodable scheduled task row", {
            taskId: row.task_id,
            cause: decoded.failure,
          });
        }
      }
      return tasks;
    });

    const findTask = Effect.fn("ScheduledTaskService.findTask")(function* (id: ScheduledTaskId) {
      const rows = yield* getRows(id).pipe(
        Effect.mapError((cause) =>
          taskError("Could not load scheduled task.", { taskId: id, cause }),
        ),
      );
      const row = rows[0];
      if (row === undefined) return null;
      return yield* decodeTaskRow(row);
    });

    const loadTask = Effect.fn("ScheduledTaskService.loadTask")(function* (id: ScheduledTaskId) {
      const task = yield* findTask(id);
      if (task === null) {
        return yield* taskError("Scheduled task not found.", { taskId: id });
      }
      return task;
    });

    const saveTask = (task: ScheduledTask) =>
      sql`
        INSERT INTO scheduled_tasks (
          task_id,
          title,
          prompt,
          enabled,
          schedule_json,
          project_id,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          max_retries,
          created_at,
          updated_at,
          next_run_at,
          last_run_at,
          last_run_status,
          last_run_error,
          run_count
        ) VALUES (
          ${task.id},
          ${task.title},
          ${task.prompt},
          ${task.enabled ? 1 : 0},
          ${JSON.stringify(task.schedule)},
          ${task.projectId},
          ${JSON.stringify(task.modelSelection)},
          ${task.runtimeMode},
          ${task.interactionMode},
          ${task.maxRetries},
          ${task.createdAt},
          ${task.updatedAt},
          ${task.nextRunAt},
          ${task.lastRunAt},
          ${task.lastRunStatus},
          ${task.lastRunError},
          ${task.runCount}
        )
        ON CONFLICT (task_id)
        DO UPDATE SET
          title = excluded.title,
          prompt = excluded.prompt,
          enabled = excluded.enabled,
          schedule_json = excluded.schedule_json,
          project_id = excluded.project_id,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          max_retries = excluded.max_retries,
          updated_at = excluded.updated_at,
          next_run_at = excluded.next_run_at
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not save scheduled task.", { taskId: task.id, cause }),
        ),
      );

    const insertRun = (run: ScheduledTaskRun) =>
      sql`
        INSERT INTO scheduled_task_runs (
          run_id,
          task_id,
          trigger,
          status,
          scheduled_for,
          started_at,
          completed_at,
          attempt_count,
          thread_id,
          error
        ) VALUES (
          ${run.id},
          ${run.taskId},
          ${run.trigger},
          ${run.status},
          ${run.scheduledFor},
          ${run.startedAt},
          ${run.completedAt},
          ${run.attemptCount},
          ${run.threadId},
          ${run.error}
        )
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not create scheduled task history row.", {
            taskId: run.taskId,
            cause,
          }),
        ),
      );

    const updateRun = (run: ScheduledTaskRun) =>
      sql`
        UPDATE scheduled_task_runs
        SET status = ${run.status},
            completed_at = ${run.completedAt},
            attempt_count = ${run.attemptCount},
            thread_id = ${run.threadId},
            error = ${run.error}
        WHERE run_id = ${run.id}
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not update scheduled task history row.", {
            taskId: run.taskId,
            cause,
          }),
        ),
      );

    const markTaskRunning = (task: ScheduledTask, startedAtIso: string) =>
      sql`
        UPDATE scheduled_tasks
        SET updated_at = ${startedAtIso},
            last_run_at = ${startedAtIso},
            last_run_status = 'running',
            last_run_error = NULL
        WHERE task_id = ${task.id}
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not mark scheduled task as running.", { taskId: task.id, cause }),
        ),
      );

    const finalizeTask = Effect.fn("ScheduledTaskService.finalizeTask")(function* (
      taskId: ScheduledTaskId,
      startedAtIso: string,
      status: "succeeded" | "failed",
      message: string | null,
    ) {
      const completedAt = yield* DateTime.now;
      const completedAtIso = iso(completedAt);
      const current = yield* findTask(taskId);
      if (current === null) return null;
      const next = nextRunAt(current, completedAt);
      yield* sql`
        UPDATE scheduled_tasks
        SET updated_at = ${completedAtIso},
            next_run_at = ${next},
            last_run_status = ${status},
            last_run_error = ${message},
            run_count = run_count + 1
        WHERE task_id = ${taskId}
          AND last_run_status = 'running'
          AND last_run_at = ${startedAtIso}
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not record scheduled task completion.", { taskId, cause }),
        ),
      );
      return {
        ...current,
        updatedAt: completedAtIso,
        nextRunAt: next,
        lastRunAt: startedAtIso,
        lastRunStatus: status,
        lastRunError: message,
        runCount: current.runCount + 1,
      } satisfies ScheduledTask;
    });

    const setRunAttempt = Effect.fn("ScheduledTaskService.setRunAttempt")(function* (
      run: ScheduledTaskRun,
      attemptCount: number,
      threadId: ThreadId,
    ) {
      const updated: ScheduledTaskRun = {
        ...run,
        status: "running",
        attemptCount,
        threadId,
        completedAt: null,
        error: null,
      };
      yield* updateRun(updated);
      yield* notifyChanged;
      return updated;
    });

    const settleThread = Effect.fn("ScheduledTaskService.settleThread")(function* (
      threadId: ThreadId,
      runId: string,
      attempt: number,
    ) {
      let lastError: string | null = null;
      for (let index = 0; index < 5; index += 1) {
        const shell = yield* projectionSnapshotQuery
          .getThreadShellById(threadId)
          .pipe(
            Effect.mapError((cause) =>
              taskError("Could not inspect scheduled task thread.", { cause }),
            ),
          );
        if (Option.isNone(shell) || shell.value.settledOverride === "settled") return null;
        const result = yield* Effect.exit(
          orchestrationEngine.dispatch({
            type: "thread.settle",
            commandId: CommandId.make(`scheduled-task:settle:${runId}:${attempt}:${index}`),
            threadId,
          }),
        );
        if (Exit.isSuccess(result)) return null;
        lastError = errorMessage(result.cause);
        yield* Effect.sleep(Duration.seconds(1));
      }
      return lastError ?? "Scheduled task thread could not be settled.";
    });

    const waitForThread = Effect.fn("ScheduledTaskService.waitForThread")(function* (
      threadId: ThreadId,
      restartRecovery = false,
    ) {
      const startedAt = DateTime.toEpochMillis(yield* DateTime.now);
      while (true) {
        const shell = yield* projectionSnapshotQuery
          .getThreadShellById(threadId)
          .pipe(
            Effect.mapError((cause) =>
              taskError("Could not inspect scheduled task thread.", { cause }),
            ),
          );
        if (Option.isNone(shell)) {
          return {
            succeeded: false,
            retryable: false,
            error: "Scheduled task thread disappeared before it completed.",
          } as const;
        }
        const thread = shell.value;
        if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
          return {
            succeeded: false,
            retryable: false,
            error: "Scheduled task requires interactive approval or user input.",
          } as const;
        }
        if (thread.latestTurn?.state === "error") {
          return {
            succeeded: false,
            retryable: true,
            error: thread.session?.lastError ?? "Scheduled task turn failed.",
          } as const;
        }
        if (thread.latestTurn?.state === "interrupted") {
          return {
            succeeded: false,
            retryable: true,
            error: "Scheduled task turn was interrupted.",
          } as const;
        }
        if (thread.session?.status === "error") {
          return {
            succeeded: false,
            retryable: true,
            error: thread.session.lastError ?? "Scheduled task provider session failed.",
          } as const;
        }
        if (thread.session?.status === "rate-limited") {
          return {
            succeeded: false,
            retryable: true,
            error: thread.session.lastError ?? "Scheduled task provider is rate limited.",
          } as const;
        }
        const sessionBusy =
          thread.session?.status === "starting" || thread.session?.status === "running";
        if (restartRecovery && isRestartInterruptedBeforeTurn(thread)) {
          return {
            succeeded: false,
            retryable: true,
            error: "Run was interrupted by a server restart before its turn started.",
          } as const;
        }
        if (
          thread.latestTurn?.state === "completed" &&
          !sessionBusy &&
          (thread.backgroundLiveness ?? null) === null
        ) {
          return { succeeded: true, retryable: false, error: null } as const;
        }
        if (DateTime.toEpochMillis(yield* DateTime.now) - startedAt >= THREAD_RUN_TIMEOUT_MS) {
          return {
            succeeded: false,
            retryable: true,
            error: "Scheduled task exceeded the six-hour execution timeout.",
          } as const;
        }
        yield* Effect.sleep(THREAD_POLL_INTERVAL);
      }
    });

    const executeAttempt = Effect.fn("ScheduledTaskService.executeAttempt")(function* (
      task: ScheduledTask,
      run: ScheduledTaskRun,
      attempt: number,
    ) {
      const project = yield* projectionSnapshotQuery
        .getProjectShellById(task.projectId)
        .pipe(
          Effect.mapError((cause) =>
            taskError("Could not inspect scheduled task project.", { taskId: task.id, cause }),
          ),
        );
      if (Option.isNone(project)) {
        return {
          succeeded: false,
          retryable: false,
          threadId: null,
          error: "Scheduled task project no longer exists.",
        };
      }

      const threadId = ThreadId.make(`${SCHEDULED_TASK_THREAD_PREFIX}${run.id}:${attempt}`);
      yield* setRunAttempt(run, attempt, threadId);
      const createdAt = iso(yield* DateTime.now);
      const createResult = yield* Effect.exit(
        orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`scheduled-task:create:${run.id}:${attempt}`),
          threadId,
          projectId: task.projectId,
          title: `[Scheduled] ${task.title}`,
          modelSelection: task.modelSelection,
          runtimeMode: task.runtimeMode,
          interactionMode: task.interactionMode,
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      );
      if (!Exit.isSuccess(createResult)) {
        return {
          succeeded: false,
          retryable: true,
          threadId,
          error: errorMessage(createResult.cause),
        };
      }

      const turnResult = yield* Effect.exit(
        orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`scheduled-task:turn:${run.id}:${attempt}`),
          threadId,
          message: {
            messageId: MessageId.make(`scheduled-task:message:${run.id}:${attempt}`),
            role: "user",
            text: automationPrompt(task),
            attachments: [],
          },
          modelSelection: task.modelSelection,
          titleSeed: task.title,
          runtimeMode: task.runtimeMode,
          interactionMode: task.interactionMode,
          createdAt,
        }),
      );
      if (!Exit.isSuccess(turnResult)) {
        const settleError = yield* settleThread(threadId, run.id, attempt);
        return {
          succeeded: false,
          retryable: true,
          threadId,
          error: [errorMessage(turnResult.cause), settleError].filter(Boolean).join(" "),
        };
      }

      const outcome = yield* waitForThread(threadId);
      const settleError = yield* settleThread(threadId, run.id, attempt);
      if (outcome.succeeded && settleError !== null) {
        return {
          succeeded: false,
          retryable: false,
          threadId,
          error: `Task completed, but its thread could not be settled: ${settleError}`,
        };
      }
      return {
        succeeded: outcome.succeeded,
        retryable: outcome.retryable,
        threadId,
        error:
          outcome.error === null
            ? settleError
            : [outcome.error, settleError].filter(Boolean).join(" "),
      };
    });

    const finishRun = Effect.fn("ScheduledTaskService.finishRun")(function* (
      task: ScheduledTask,
      run: ScheduledTaskRun,
      result: AttemptResult,
      attemptCount: number,
      historyStatus: "succeeded" | "failed" | "interrupted" = result.succeeded
        ? "succeeded"
        : "failed",
    ) {
      const completedAt = iso(yield* DateTime.now);
      const terminalRun: ScheduledTaskRun = {
        ...run,
        status: historyStatus,
        completedAt,
        attemptCount,
        threadId: result.threadId,
        error: result.error,
      };
      yield* updateRun(terminalRun);
      const taskResult = yield* finalizeTask(
        task.id,
        run.startedAt,
        result.succeeded ? "succeeded" : "failed",
        result.error,
      );
      yield* notifyChanged;
      return taskResult ?? task;
    });

    const executeRun = Effect.fn("ScheduledTaskService.executeRun")(function* (
      task: ScheduledTask,
      run: ScheduledTaskRun,
      startAttempt: number,
    ) {
      let currentRun = run;
      let lastResult: AttemptResult = {
        succeeded: false,
        retryable: true,
        threadId: run.threadId,
        error: "Scheduled task did not start.",
      };
      const maxAttempts = task.maxRetries + 1;
      for (let attempt = startAttempt; attempt <= maxAttempts; attempt += 1) {
        lastResult = yield* executeAttempt(task, currentRun, attempt);
        currentRun = {
          ...run,
          attemptCount: attempt,
          threadId: lastResult.threadId,
          error: lastResult.error,
        };
        if (lastResult.succeeded) {
          return yield* finishRun(task, currentRun, lastResult, attempt);
        }
        if (!lastResult.retryable || attempt >= maxAttempts) {
          return yield* finishRun(task, currentRun, lastResult, attempt);
        }
        yield* updateRun(currentRun);
        yield* notifyChanged;
        yield* Effect.sleep(Duration.seconds(Math.min(30, attempt * 5)));
      }
      return yield* finishRun(task, currentRun, lastResult, currentRun.attemptCount);
    });

    const runTask = Effect.fn("ScheduledTaskService.runTask")(function* (
      task: ScheduledTask,
      trigger: "scheduled" | "manual",
    ) {
      const reserved = yield* Ref.modify(activeRuns, (active) => {
        if (active.has(task.id)) return [false, active] as const;
        const next = new Set(active);
        next.add(task.id);
        return [true, next] as const;
      });
      if (!reserved) {
        if (trigger === "manual") {
          return yield* taskError("Scheduled task is already running.", { taskId: task.id });
        }
        return task;
      }

      return yield* Effect.gen(function* () {
        const now = yield* DateTime.now;
        const startedAt = iso(now);
        const active = yield* findTask(task.id);
        if (active === null) {
          if (trigger === "manual") {
            return yield* taskError("Scheduled task not found.", { taskId: task.id });
          }
          return task;
        }
        if (
          trigger === "scheduled" &&
          (!active.enabled ||
            active.nextRunAt === null ||
            DateTime.toEpochMillis(DateTime.makeUnsafe(active.nextRunAt)) >
              DateTime.toEpochMillis(now))
        ) {
          return active;
        }

        const runId = `scheduled-task-run:${yield* randomUuid}`;
        const run: ScheduledTaskRun = {
          id: runId,
          taskId: active.id,
          trigger,
          status: "running",
          scheduledFor: trigger === "scheduled" ? active.nextRunAt : null,
          startedAt,
          completedAt: null,
          attemptCount: 0,
          threadId: null,
          error: null,
        };
        yield* insertRun(run);
        yield* markTaskRunning(active, startedAt);
        yield* notifyChanged;
        return yield* executeRun(active, run, 1);
      }).pipe(
        Effect.onError((cause) =>
          Effect.logWarning("Scheduled task execution escaped its run state machine", {
            taskId: task.id,
            cause,
          }),
        ),
        Effect.ensuring(
          Ref.update(activeRuns, (active) => {
            const next = new Set(active);
            next.delete(task.id);
            return next;
          }),
        ),
      );
    });

    const recordMissedRun = Effect.fn("ScheduledTaskService.recordMissedRun")(function* (
      task: ScheduledTask,
      now: DateTime.DateTime,
    ) {
      const nowIso = iso(now);
      const next = nextRunAt(task, now);
      const run: ScheduledTaskRun = {
        id: `scheduled-task-run:${yield* randomUuid}`,
        taskId: task.id,
        trigger: "scheduled",
        status: "missed",
        scheduledFor: task.nextRunAt,
        startedAt: nowIso,
        completedAt: nowIso,
        attemptCount: 0,
        threadId: null,
        error: "Skipped because the server was offline for more than 24 hours after this slot.",
      };
      yield* insertRun(run);
      yield* sql`
        UPDATE scheduled_tasks
        SET next_run_at = ${next},
            updated_at = ${nowIso}
        WHERE task_id = ${task.id}
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not reschedule missed scheduled task run.", { taskId: task.id, cause }),
        ),
      );
      yield* notifyChanged;
    });

    const runDueTasks = Effect.fn("ScheduledTaskService.runDueTasks")(function* () {
      const tasks = yield* listTasksLenient().pipe(
        Effect.mapError((cause) => taskError("Could not list scheduled tasks.", { cause })),
      );
      const now = yield* DateTime.now;
      const nowEpochMs = DateTime.toEpochMillis(now);
      const due = tasks.flatMap((task) => {
        if (!task.enabled || task.nextRunAt === null || task.lastRunStatus === "running") return [];
        const dueAt = DateTime.makeUnsafe(task.nextRunAt);
        return DateTime.toEpochMillis(dueAt) <= nowEpochMs ? [{ task, dueAt }] : [];
      });
      yield* Effect.forEach(
        due,
        ({ task, dueAt }) =>
          isMissedFixedTimeRun(task.schedule, dueAt, now)
            ? recordMissedRun(task, now).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Scheduled task run failed", { taskId: task.id, cause }),
                ),
              )
            : runTask(task, "scheduled").pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Scheduled task run failed", { taskId: task.id, cause }),
                ),
                Effect.forkScoped({ startImmediately: true }),
                Effect.asVoid,
              ),
        { concurrency: "unbounded", discard: true },
      );
    });

    const recoverInterruptedRuns = Effect.fn("ScheduledTaskService.recoverInterruptedRuns")(
      function* () {
        const rows = yield* selectRunningHistoryRows();
        for (const row of rows) {
          const decodedRun = yield* Effect.result(decodeRunRow(row));
          if (!Result.isSuccess(decodedRun)) {
            yield* Effect.logWarning(
              "Could not decode running scheduled task history during restart recovery",
              {
                runId: row.run_id,
                cause: decodedRun.failure,
              },
            );
            continue;
          }
          const run = decodedRun.success;
          const task = yield* findTask(run.taskId);
          if (task === null) continue;
          const reserved = yield* Ref.modify(activeRuns, (active) => {
            if (active.has(task.id)) return [false, active] as const;
            const next = new Set(active);
            next.add(task.id);
            return [true, next] as const;
          });
          if (!reserved) continue;

          yield* Effect.gen(function* () {
            if (run.threadId === null) {
              return yield* finishRun(
                task,
                run,
                {
                  succeeded: false,
                  retryable: false,
                  threadId: null,
                  error: "Run was interrupted by a server restart before a thread was launched.",
                },
                run.attemptCount,
                "interrupted",
              );
            }
            const shell = yield* projectionSnapshotQuery.getThreadShellById(run.threadId);
            if (Option.isNone(shell)) {
              return yield* finishRun(
                task,
                run,
                {
                  succeeded: false,
                  retryable: false,
                  threadId: run.threadId,
                  error: "Run was interrupted by a server restart and its thread no longer exists.",
                },
                run.attemptCount,
                "interrupted",
              );
            }

            const outcome = yield* waitForThread(run.threadId, true);
            const settleError = yield* settleThread(run.threadId, run.id, run.attemptCount);
            const result: AttemptResult = outcome.succeeded
              ? settleError === null
                ? { succeeded: true, retryable: false, threadId: run.threadId, error: null }
                : {
                    succeeded: false,
                    retryable: false,
                    threadId: run.threadId,
                    error: `Task completed after restart, but its thread could not be settled: ${settleError}`,
                  }
              : {
                  succeeded: false,
                  retryable: outcome.retryable,
                  threadId: run.threadId,
                  error: [outcome.error, settleError].filter(Boolean).join(" "),
                };
            if (!result.succeeded && result.retryable && run.attemptCount <= task.maxRetries) {
              yield* Effect.sleep(Duration.seconds(5));
              return yield* executeRun(task, { ...run, error: result.error }, run.attemptCount + 1);
            }
            return yield* finishRun(task, run, result, run.attemptCount);
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Scheduled task restart recovery failed", {
                taskId: task.id,
                runId: run.id,
                cause,
              }),
            ),
            Effect.ensuring(
              Ref.update(activeRuns, (active) => {
                const next = new Set(active);
                next.delete(task.id);
                return next;
              }),
            ),
            Effect.forkScoped({ startImmediately: true }),
          );
        }
      },
    );

    const worker = Effect.gen(function* () {
      yield* recoverInterruptedRuns().pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Scheduled task restart recovery failed before polling", { cause }),
        ),
      );
      return yield* Effect.forever(
        runDueTasks().pipe(
          Effect.catch((cause) => Effect.logWarning("Scheduled task polling failed", { cause })),
          Effect.andThen(Effect.sleep(POLL_INTERVAL)),
        ),
      );
    });

    const start: ScheduledTaskService["Service"]["start"] = Effect.gen(function* () {
      const shouldStart = yield* Ref.modify(started, (value) => [!value, true] as const);
      if (!shouldStart) return;
      yield* Effect.forkScoped(worker);
    });

    const list: ScheduledTaskService["Service"]["list"] = () =>
      Effect.all({ tasks: listRows(), runs: listRuns() }, { concurrency: 2 });

    const subscribeList: ScheduledTaskService["Service"]["subscribeList"] = () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changesPubSub);
          return Stream.concat(
            Stream.fromEffect(list()),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list())),
          );
        }),
      );

    const upsert: ScheduledTaskService["Service"]["upsert"] = (input) =>
      Effect.gen(function* () {
        if (input.schedule.type === "fixed_time" && !isValidTimeZone(input.schedule.timeZone)) {
          return yield* taskError(`Invalid IANA time zone: ${input.schedule.timeZone}`);
        }
        const now = yield* DateTime.now;
        const uuid = input.commandId === undefined ? yield* randomUuid : null;
        const id =
          input.id ??
          ScheduledTaskId.make(
            input.commandId ? `scheduled-task:${input.commandId}` : `scheduled-task:${uuid}`,
          );
        const existing = yield* findTask(id);
        const scheduleUnchanged =
          existing !== null &&
          existing.enabled === input.enabled &&
          isSameSchedule(existing.schedule, input.schedule);
        const task: ScheduledTask = {
          id,
          title: input.title,
          prompt: input.prompt,
          enabled: input.enabled,
          schedule: input.schedule,
          projectId: input.projectId,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          maxRetries: input.maxRetries ?? existing?.maxRetries ?? DEFAULT_MAX_RETRIES,
          createdAt: existing?.createdAt ?? iso(now),
          updatedAt: iso(now),
          nextRunAt: scheduleUnchanged
            ? existing.nextRunAt
            : nextRunAt({ enabled: input.enabled, schedule: input.schedule }, now),
          lastRunAt: existing?.lastRunAt ?? null,
          lastRunStatus: existing?.lastRunStatus ?? "never",
          lastRunError: existing?.lastRunError ?? null,
          runCount: existing?.runCount ?? 0,
        };
        yield* saveTask(task);
        yield* notifyChanged;
        return { task };
      });

    const setEnabled: ScheduledTaskService["Service"]["setEnabled"] = (input) =>
      Effect.gen(function* () {
        const existing = yield* loadTask(input.id);
        if (existing.enabled === input.enabled) return { task: existing };
        const now = yield* DateTime.now;
        const updatedAt = iso(now);
        const next = nextRunAt({ enabled: input.enabled, schedule: existing.schedule }, now);
        const rows = yield* sql<{ task_id: string }>`
          UPDATE scheduled_tasks
          SET enabled = ${input.enabled ? 1 : 0},
              next_run_at = ${next},
              updated_at = ${updatedAt}
          WHERE task_id = ${input.id}
          RETURNING task_id
        `.pipe(
          Effect.mapError((cause) =>
            taskError("Could not update scheduled task.", { taskId: input.id, cause }),
          ),
        );
        if (rows.length === 0) {
          return yield* taskError("Scheduled task not found.", { taskId: input.id });
        }
        yield* notifyChanged;
        return { task: { ...existing, enabled: input.enabled, nextRunAt: next, updatedAt } };
      });

    const deleteTask: ScheduledTaskService["Service"]["delete"] = (input) =>
      sql`DELETE FROM scheduled_tasks WHERE task_id = ${input.id}`.pipe(
        Effect.mapError((cause) =>
          taskError("Could not delete scheduled task.", { taskId: input.id, cause }),
        ),
        Effect.andThen(notifyChanged),
        Effect.as({ id: input.id }),
      );

    const runNow: ScheduledTaskService["Service"]["runNow"] = (input: ScheduledTaskRunNowInput) =>
      Effect.gen(function* () {
        const task = yield* loadTask(input.id);
        const result = yield* runTask(task, "manual");
        return { task: result };
      });

    return ScheduledTaskService.of({
      start,
      list,
      subscribeList,
      upsert,
      setEnabled,
      delete: deleteTask,
      runNow,
    });
  }),
);
