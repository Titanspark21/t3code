import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { ScheduledTaskId, type ScheduledTask } from "@t3tools/contracts/scheduledTasks";
import * as Effect from "effect/Effect";

import { dispatchScheduledTaskTarget } from "./ScheduledTaskRunner.ts";

describe("dispatchScheduledTaskTarget", () => {
  it.effect("creates the hidden thread before starting its provider turn", () =>
    Effect.gen(function* () {
      const commands: OrchestrationCommand[] = [];
      const lifecycle: string[] = [];
      const createdAt = "2026-09-03T12:00:00.000Z";
      const task: ScheduledTask = {
        id: ScheduledTaskId.make("task-1"),
        name: "Morning check",
        prompt: "Say hi",
        projectId: ProjectId.make("project-1"),
        targets: [
          {
            instanceId: ProviderInstanceId.make("codex-2"),
            model: "gpt-5.6-luna",
            options: [{ id: "reasoningEffort", value: "low" }],
          },
        ],
        schedule: { timeOfDay: "05:00", daysOfWeek: [] },
        enabled: true,
        runtimeMode: "full-access",
        createdAt,
        updatedAt: createdAt,
      };

      yield* dispatchScheduledTaskTarget({
        dispatch: (command) => {
          commands.push(command);
          lifecycle.push(command.type);
          return Effect.succeed({ sequence: commands.length });
        },
        task,
        target: task.targets[0]!,
        threadId: ThreadId.make("thread-1"),
        createCommandId: CommandId.make("create-1"),
        turnCommandId: CommandId.make("turn-1"),
        messageId: MessageId.make("message-1"),
        createdAt,
        afterThreadCreated: Effect.sync(() => lifecycle.push("registered")),
      });

      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
      ]);
      expect(commands[0]).toMatchObject({
        type: "thread.create",
        threadId: "thread-1",
        projectId: "project-1",
        modelSelection: {
          instanceId: "codex-2",
          model: "gpt-5.6-luna",
          options: [{ id: "reasoningEffort", value: "low" }],
        },
      });
      expect(commands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: "thread-1",
        message: { text: "Say hi" },
        modelSelection: { instanceId: "codex-2", model: "gpt-5.6-luna" },
      });
      expect("bootstrap" in commands[1]!).toBe(false);
      expect(lifecycle).toEqual(["thread.create", "registered", "thread.turn.start"]);
    }),
  );
});
