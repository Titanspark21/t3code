import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationThreadShell } from "@t3tools/contracts";

import { isRestartInterruptedBeforeTurn } from "./ScheduledTaskService.ts";

const runningSession = {
  status: "running",
} as NonNullable<OrchestrationThreadShell["session"]>;

describe("scheduled task restart recovery", () => {
  it("treats an idle persisted thread with no turn as interrupted", () => {
    expect(
      isRestartInterruptedBeforeTurn({
        latestTurn: null,
        session: null,
        backgroundLiveness: null,
      }),
    ).toBe(true);
  });

  it("does not retry while a no-turn thread still has live work", () => {
    expect(
      isRestartInterruptedBeforeTurn({
        latestTurn: null,
        session: runningSession,
        backgroundLiveness: null,
      }),
    ).toBe(false);
    expect(
      isRestartInterruptedBeforeTurn({
        latestTurn: null,
        session: null,
        backgroundLiveness: "working",
      }),
    ).toBe(false);
  });
});
