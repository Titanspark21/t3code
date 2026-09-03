import { describe, expect, it } from "@effect/vitest";

import {
  antigravityStreamArgs,
  promptSession,
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
