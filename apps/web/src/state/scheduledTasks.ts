/**
 * Scheduled tasks, per connected environment.
 *
 * Tasks belong to the machine that runs them — its clock decides when they
 * fire and its provider instances are what they address — so they are never
 * flattened across environments the way a purely client-side list would be.
 *
 * @module state/scheduledTasks
 */
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ScheduledTask,
  ScheduledTaskDraft,
  ScheduledTaskId,
} from "@t3tools/contracts/scheduledTasks";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export interface EnvironmentScheduledTasks {
  readonly environmentId: EnvironmentId;
  readonly tasks: ReadonlyArray<ScheduledTask>;
  readonly isPending: boolean;
}

const scheduledTasksAtom = Atom.make((get): readonly EnvironmentScheduledTasks[] => {
  const presentations = get(environmentPresentations.presentationsAtom);
  const statuses: EnvironmentScheduledTasks[] = [];
  for (const [environmentId] of presentations) {
    const result = get(serverEnvironment.scheduledTasks({ environmentId, input: {} }));
    const value = Option.getOrNull(AsyncResult.value(result));
    statuses.push({
      environmentId,
      tasks: value?.tasks ?? [],
      isPending: result.waiting,
    });
  }
  return statuses;
}).pipe(Atom.withLabel("web-scheduled-tasks"));

export interface ScheduledTasksView {
  readonly environments: readonly EnvironmentScheduledTasks[];
  readonly save: (environmentId: EnvironmentId, task: ScheduledTaskDraft) => Promise<void>;
  readonly remove: (environmentId: EnvironmentId, id: ScheduledTaskId) => Promise<void>;
  readonly runNow: (environmentId: EnvironmentId, id: ScheduledTaskId) => Promise<void>;
}

export function useScheduledTasks(): ScheduledTasksView {
  const environments = useAtomValue(scheduledTasksAtom);

  // Every mutation answers with the whole list, but the query atom is what the
  // UI renders, so it is refreshed rather than patched from the response.
  const refresh = useCallback((environmentId: EnvironmentId) => {
    appAtomRegistry.refresh(serverEnvironment.scheduledTasks({ environmentId, input: {} }));
  }, []);

  const save = useCallback(
    async (environmentId: EnvironmentId, task: ScheduledTaskDraft) => {
      await runAtomCommand(
        appAtomRegistry,
        serverEnvironment.saveScheduledTask,
        { environmentId, input: { task } },
        { label: "save scheduled task" },
      );
      refresh(environmentId);
    },
    [refresh],
  );

  const remove = useCallback(
    async (environmentId: EnvironmentId, id: ScheduledTaskId) => {
      await runAtomCommand(
        appAtomRegistry,
        serverEnvironment.deleteScheduledTask,
        { environmentId, input: { id } },
        { label: "delete scheduled task" },
      );
      refresh(environmentId);
    },
    [refresh],
  );

  const runNow = useCallback(
    async (environmentId: EnvironmentId, id: ScheduledTaskId) => {
      await runAtomCommand(
        appAtomRegistry,
        serverEnvironment.runScheduledTask,
        { environmentId, input: { id } },
        { label: "run scheduled task" },
      );
      refresh(environmentId);
    },
    [refresh],
  );

  return useMemo(
    () => ({ environments, save, remove, runNow }),
    [environments, save, remove, runNow],
  );
}
