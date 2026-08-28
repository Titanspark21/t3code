import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isSameInterruptTarget,
  shouldClearInterruptingTurn,
  type InterruptingTurnTarget,
} from "./interruptState";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const turnId = TurnId.make("turn-1");
const otherTurnId = TurnId.make("turn-2");

const target: InterruptingTurnTarget = { environmentId, threadId, turnId };

describe("interruptState", () => {
  it("matches only the same environment, thread, and turn", () => {
    expect(isSameInterruptTarget(target, target)).toBe(true);
    expect(
      isSameInterruptTarget(target, {
        ...target,
        environmentId: EnvironmentId.make("environment-2"),
      }),
    ).toBe(false);
    expect(isSameInterruptTarget(target, { ...target, turnId: otherTurnId })).toBe(false);
  });

  it("keeps a stop request pending while its hidden thread is still running", () => {
    expect(
      shouldClearInterruptingTurn({
        target,
        activeEnvironmentId: EnvironmentId.make("environment-2"),
        activeThreadId: ThreadId.make("thread-2"),
        activeTurnId: null,
        phase: "ready",
      }),
    ).toBe(false);
  });

  it("clears once the target thread reports idle", () => {
    expect(
      shouldClearInterruptingTurn({
        target,
        activeEnvironmentId: environmentId,
        activeThreadId: threadId,
        activeTurnId: turnId,
        phase: "ready",
      }),
    ).toBe(true);
  });

  it("clears when a new turn replaces the interrupted one", () => {
    expect(
      shouldClearInterruptingTurn({
        target,
        activeEnvironmentId: environmentId,
        activeThreadId: threadId,
        activeTurnId: otherTurnId,
        phase: "running",
      }),
    ).toBe(true);
  });
});
