import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection, ProviderInteractionMode, RuntimeMode } from "./orchestration.ts";

/** Scheduler-owned orchestration threads stay settled and out of the normal inbox. */
export const SCHEDULED_TASK_THREAD_PREFIX = "scheduler-thread:" as const;

export function isScheduledTaskThreadId(threadId: string): boolean {
  return threadId.startsWith(SCHEDULED_TASK_THREAD_PREFIX);
}

/** 24-hour "HH:MM" wall-clock time. Mirrors `parseTimeOfDay` on the server. */
const TimeOfDay = TrimmedNonEmptyString.check(Schema.isPattern(/^([01]?\d|2[0-3]):([0-5]\d)$/));

/**
 * Fixed-time schedules store an IANA time-zone id instead of inheriting the
 * server process zone. This keeps a 09:00 task at 09:00 for the user across
 * restarts, host moves, and DST transitions.
 */
export const ScheduledTaskSchedule = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("interval"),
    everyMs: PositiveInt,
  }),
  Schema.Struct({
    type: Schema.Literal("fixed_time"),
    timeOfDay: TimeOfDay,
    timeZone: TrimmedNonEmptyString,
    weekdays: Schema.optional(
      Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }))),
    ),
  }),
]);
export type ScheduledTaskSchedule = typeof ScheduledTaskSchedule.Type;

export const ScheduledTaskRunStatus = Schema.Literals(["never", "running", "succeeded", "failed"]);
export type ScheduledTaskRunStatus = typeof ScheduledTaskRunStatus.Type;

export const ScheduledTaskHistoryStatus = Schema.Literals([
  "running",
  "succeeded",
  "failed",
  "interrupted",
  "missed",
]);
export type ScheduledTaskHistoryStatus = typeof ScheduledTaskHistoryStatus.Type;

export const ScheduledTaskRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  taskId: ScheduledTaskId,
  trigger: Schema.Literals(["scheduled", "manual"]),
  status: ScheduledTaskHistoryStatus,
  scheduledFor: Schema.NullOr(IsoDateTime),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  attemptCount: NonNegativeInt,
  threadId: Schema.NullOr(ThreadId),
  error: Schema.NullOr(Schema.String),
});
export type ScheduledTaskRun = typeof ScheduledTaskRun.Type;

export const ScheduledTask = Schema.Struct({
  id: ScheduledTaskId,
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  schedule: ScheduledTaskSchedule,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  /** Number of retries after the initial attempt. */
  maxRetries: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 })),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunAt: Schema.NullOr(IsoDateTime),
  lastRunStatus: ScheduledTaskRunStatus,
  lastRunError: Schema.NullOr(Schema.String),
  runCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ScheduledTask = typeof ScheduledTask.Type;

export const ScheduledTaskListInput = Schema.Struct({});
export type ScheduledTaskListInput = typeof ScheduledTaskListInput.Type;

export const ScheduledTaskListResult = Schema.Struct({
  tasks: Schema.Array(ScheduledTask),
  /** Newest first, bounded by the server so subscriptions remain small. */
  runs: Schema.Array(ScheduledTaskRun),
});
export type ScheduledTaskListResult = typeof ScheduledTaskListResult.Type;

export const ScheduledTaskUpsertInput = Schema.Struct({
  id: Schema.optional(ScheduledTaskId),
  commandId: Schema.optional(CommandId),
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  schedule: ScheduledTaskSchedule,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  maxRetries: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))),
});
export type ScheduledTaskUpsertInput = typeof ScheduledTaskUpsertInput.Type;

/** Partial update that flips only the enabled flag — never overwrites other fields. */
export const ScheduledTaskSetEnabledInput = Schema.Struct({
  id: ScheduledTaskId,
  enabled: Schema.Boolean,
});
export type ScheduledTaskSetEnabledInput = typeof ScheduledTaskSetEnabledInput.Type;

export const ScheduledTaskDeleteInput = Schema.Struct({
  id: ScheduledTaskId,
});
export type ScheduledTaskDeleteInput = typeof ScheduledTaskDeleteInput.Type;

export const ScheduledTaskRunNowInput = Schema.Struct({
  id: ScheduledTaskId,
});
export type ScheduledTaskRunNowInput = typeof ScheduledTaskRunNowInput.Type;

export const ScheduledTaskMutationResult = Schema.Struct({
  task: ScheduledTask,
});
export type ScheduledTaskMutationResult = typeof ScheduledTaskMutationResult.Type;

export const ScheduledTaskDeleteResult = Schema.Struct({
  id: ScheduledTaskId,
});
export type ScheduledTaskDeleteResult = typeof ScheduledTaskDeleteResult.Type;

export const ScheduledTaskRunNowResult = Schema.Struct({
  task: ScheduledTask,
});
export type ScheduledTaskRunNowResult = typeof ScheduledTaskRunNowResult.Type;

export class ScheduledTaskError extends Schema.TaggedErrorClass<ScheduledTaskError>()(
  "ScheduledTaskError",
  {
    message: Schema.String,
    taskId: Schema.optional(ScheduledTaskId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
