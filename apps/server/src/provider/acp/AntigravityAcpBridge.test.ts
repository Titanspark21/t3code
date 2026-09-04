import { describe, expect, it } from "@effect/vitest";

import {
  antigravityStreamArgs,
  promptSession,
  resolveAvailableAntigravityModelId,
  toolKind,
  toolStatus,
  toolTitle,
  type AgyPromptSession,
} from "./AntigravityAcpBridge.ts";

describe("antigravityStreamArgs", () => {
  it("puts the thread workspace on the command line", () => {
    const args = antigravityStreamArgs({ cwd: "/repo/app" });
    // Without this pair the CLI works out of a scratch directory under its
    // profile home and silently edits nothing in the user's project.
    expect(args).toContain("--add-dir");
    expect(args[args.indexOf("--add-dir") + 1]).toBe("/repo/app");
  });

  it("resumes a conversation with the selected model and mode", () => {
    const args = antigravityStreamArgs({
      cwd: "/repo/app",
      model: "gemini-3.5-flash-high",
      conversationId: "conv-1",
      mode: "accept-edits",
    });
    expect(args).toEqual([
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--add-dir",
      "/repo/app",
      "--model",
      "gemini-3.5-flash-high",
      "--conversation",
      "conv-1",
      "--mode",
      "accept-edits",
    ]);
  });

  it("drops a mode the CLI does not accept", () => {
    expect(antigravityStreamArgs({ cwd: "/repo/app", mode: "full-access" })).not.toContain(
      "--mode",
    );
  });
});

describe("tool step mapping", () => {
  it("classifies the tools agy actually reports", () => {
    expect(toolKind("view_file")).toBe("read");
    expect(toolKind("replace_file_content")).toBe("edit");
    expect(toolKind("write_to_file")).toBe("edit");
    expect(toolKind("find_by_name")).toBe("search");
    expect(toolKind("run_command")).toBe("execute");
    expect(toolKind("browser_get_dom")).toBe("fetch");
    expect(toolKind("ask_question")).toBe("other");
  });

  it("maps step state to ACP tool call status", () => {
    expect(toolStatus("ACTIVE")).toBe("in_progress");
    expect(toolStatus("DONE")).toBe("completed");
    expect(toolStatus("ERROR")).toBe("failed");
    expect(toolStatus(undefined)).toBe("pending");
  });

  it("titles a tool row with the detail worth reading", () => {
    expect(toolTitle("run_command", { CommandLine: "pnpm test" })).toBe("pnpm test");
    expect(toolTitle("view_file", { AbsolutePath: "/repo/a.ts" })).toBe("view_file /repo/a.ts");
    expect(toolTitle("ask_question", {})).toBe("ask_question");
  });
});

describe("prompt result handling", () => {
  function sessionWithResult(result: Record<string, unknown>): AgyPromptSession {
    let delivered = false;
    return {
      sessionId: "agy-test",
      cwd: "/repo/app",
      announcedToolCalls: new Set(),
      beginTurn: () => undefined,
      toolCallId: (index) => `tool-${String(index)}`,
      sendPrompt: async () => undefined,
      nextEvent: async () => {
        if (delivered) throw new Error("Test exhausted its events.");
        delivered = true;
        return { result };
      },
      close: () => undefined,
    };
  }

  it("makes an otherwise blank successful turn visible", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const result = await promptSession(
      sessionWithResult({ status: "SUCCESS" }),
      { prompt: [{ type: "text", text: "Review the project" }] },
      (_sessionId, update) => updates.push(update),
    );

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

  it("rejects a provider failure instead of completing it as a refusal", async () => {
    await expect(
      promptSession(
        sessionWithResult({ status: "ERROR", response: "tool execution failed" }),
        { prompt: [{ type: "text", text: "Review the project" }] },
        () => undefined,
      ),
    ).rejects.toThrow("tool execution failed");
  });
});

describe("resolveAvailableAntigravityModelId", () => {
  const available = [
    { modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
    { modelId: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
    { modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
    { modelId: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
    { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
  ];

  it("resolves a family slug to the strongest published variant", () => {
    // The picker shows one "Gemini 3.8 Flash" entry, so a selection without an
    // effort arrives as the family slug that `agy models` never lists.
    expect(resolveAvailableAntigravityModelId("gemini-3.8-flash", available)).toBe(
      "gemini-3.8-flash-high",
    );
  });

  it("skips efforts a family does not publish", () => {
    expect(resolveAvailableAntigravityModelId("gemini-3.1-pro", available)).toBe(
      "gemini-3.1-pro-low",
    );
  });

  it("keeps an exact id untouched", () => {
    expect(resolveAvailableAntigravityModelId("gemini-3.8-flash-medium", available)).toBe(
      "gemini-3.8-flash-medium",
    );
    expect(resolveAvailableAntigravityModelId("claude-sonnet-4-6", available)).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("reports a family with no variant as unknown", () => {
    expect(resolveAvailableAntigravityModelId("gemini-9.9-flash", available)).toBeUndefined();
  });

  it("passes the request through when discovery produced nothing", () => {
    // An empty catalogue means `agy models` failed; let the CLI answer.
    expect(resolveAvailableAntigravityModelId("gemini-3.8-flash", [])).toBe("gemini-3.8-flash");
  });
});
