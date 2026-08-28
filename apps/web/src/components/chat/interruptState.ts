import type { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";

import type { SessionPhase } from "../../types";

export interface InterruptingTurnTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
}

export function isSameInterruptTarget(
  left: InterruptingTurnTarget | null,
  right: InterruptingTurnTarget,
): boolean {
  return (
    left !== null &&
    left.environmentId === right.environmentId &&
    left.threadId === right.threadId &&
    left.turnId === right.turnId
  );
}

/**
 * Keep a stop request visible while its thread is hidden, but release it as
 * soon as that thread reports idle or a different turn becomes active.
 */
export function shouldClearInterruptingTurn(input: {
  readonly target: InterruptingTurnTarget;
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly activeThreadId: ThreadId | null;
  readonly activeTurnId: TurnId | null;
  readonly phase: SessionPhase;
}): boolean {
  if (
    input.target.environmentId !== input.activeEnvironmentId ||
    input.target.threadId !== input.activeThreadId
  ) {
    return false;
  }

  return input.phase !== "running" || input.target.turnId !== input.activeTurnId;
}
