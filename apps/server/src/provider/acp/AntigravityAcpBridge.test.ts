// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  AgySession,
  promptSession,
  type AgyEvent,
  type AgyPromptSession,
} from "./AntigravityAcpBridge.ts";

function makePromptSession(events: ReadonlyArray<AgyEvent | Error>) {
  const pending = [...events];
  const prompts: string[] = [];
  const session: AgyPromptSession = {
    sessionId: "agy-test-session",
    cwd: process.cwd(),
    sendPrompt: (text) => prompts.push(text),
    nextEvent: async () => {
      const next = pending.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error("Test exhausted Antigravity events.");
      return next;
    },
    close: () => undefined,
  };
  return { session, prompts };
}

function promptParams(text = "fix the code") {
  return { prompt: [{ type: "text", text }] };
}

describe("AntigravityAcpBridge prompt lifecycle", () => {
  it("streams simple chat output without inventing tool progress", async () => {
    const { session, prompts } = makePromptSession([
      { result: { status: "SUCCESS", response: "hello from agy" } },
    ]);
    const updates: Array<Record<string, unknown>> = [];

    const result = await promptSession(session, promptParams("hello"), (_sessionId, update) => {
      updates.push(update);
    });

    expect(prompts).toEqual(["hello"]);
    expect(result.stopReason).toBe("end_turn");
    expect(updates).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello from agy" },
      },
    ]);
  });

  it("retains coding output and exposes AGY tool progress", async () => {
    const { session } = makePromptSession([
      {
        step_update: {
          step_index: 2,
          step_type: "tool",
          state: "ACTIVE",
          tool_name: "write_to_file",
          tool_info: { path: "src/example.ts" },
        },
      },
      {
        step_update: {
          step_index: 2,
          step_type: "tool",
          state: "DONE",
          tool_name: "write_to_file",
          tool_info: { path: "src/example.ts", changed: true },
        },
      },
      {
        step_update: {
          step_index: 3,
          step_type: "agent_response",
          state: "DONE",
          text_delta: "Implemented and tested.",
        },
      },
      { result: { status: "SUCCESS", response: "Implemented and tested." } },
    ]);
    const updates: Array<Record<string, unknown>> = [];

    await promptSession(session, promptParams(), (_sessionId, update) => updates.push(update));

    expect(updates).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "agy-step-2",
        title: "write_to_file",
        kind: "edit",
        status: "in_progress",
        rawInput: { path: "src/example.ts" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "agy-step-2",
        status: "completed",
        rawOutput: { path: "src/example.ts", changed: true },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Implemented and tested." },
      },
    ]);
  });

  it("surfaces provider failures instead of returning a blank refusal", async () => {
    const { session } = makePromptSession([
      { result: { status: "ERROR", response: "tool execution failed" } },
    ]);
    const updates: Array<Record<string, unknown>> = [];

    await expect(
      promptSession(session, promptParams(), (_sessionId, update) => updates.push(update)),
    ).rejects.toThrow("tool execution failed");
    expect(updates).toEqual([]);
  });

  it("makes a successful empty result explicit", async () => {
    const { session } = makePromptSession([{ result: { status: "SUCCESS" } }]);
    const updates: Array<Record<string, unknown>> = [];

    const result = await promptSession(session, promptParams(), (_sessionId, update) => {
      updates.push(update);
    });

    expect(result.stopReason).toBe("end_turn");
    expect(updates).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Antigravity completed the task without a text response.",
        },
      },
    ]);
  });

  it("propagates a stream timeout rather than completing blank", async () => {
    const { session } = makePromptSession([
      new Error("Timed out waiting for Antigravity CLI stream output."),
    ]);

    await expect(promptSession(session, promptParams(), () => undefined)).rejects.toThrow(
      "Timed out waiting for Antigravity CLI stream output.",
    );
  });
});

describe("AgySession cleanup", () => {
  it("kills a silent stream process on timeout and keeps the terminal error", async () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-agy-stream-test-"));
    const binary = NodePath.join(tempDir, "agy-hang");
    NodeFS.writeFileSync(
      binary,
      "#!/usr/bin/env node\nprocess.stdin.resume();\nsetInterval(() => undefined, 1000);\n",
      { mode: 0o755 },
    );
    const previousBinary = process.env.AGY_BINARY;
    process.env.AGY_BINARY = binary;
    const session = new AgySession("agy-timeout", process.cwd(), {
      availableModels: [],
      currentModelId: "default",
    });

    try {
      await expect(session.nextEvent(25)).rejects.toThrow("Timed out waiting 25ms");
      expect(session.child.killed).toBe(true);
      await expect(session.nextEvent()).rejects.toThrow("Timed out waiting 25ms");
    } finally {
      session.close();
      if (previousBinary === undefined) delete process.env.AGY_BINARY;
      else process.env.AGY_BINARY = previousBinary;
      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
