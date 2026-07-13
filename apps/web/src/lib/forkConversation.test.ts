import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationMessage } from "@t3tools/contracts";

import { buildForkContextPrompt, serializeThreadTranscript } from "./forkConversation";

function message(role: OrchestrationMessage["role"], text: string): OrchestrationMessage {
  return {
    id: `${role}-${text.slice(0, 4)}` as OrchestrationMessage["id"],
    role,
    text,
    turnId: null,
    streaming: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("serializeThreadTranscript", () => {
  it("renders user/assistant messages and skips system/empty ones", () => {
    const transcript = serializeThreadTranscript([
      message("system", "you are helpful"),
      message("user", "hello"),
      message("assistant", "hi there"),
      message("user", "   "),
    ]);
    expect(transcript).toBe("**User:**\nhello\n\n**Assistant:**\nhi there");
  });

  it("truncates very long transcripts and marks the truncation", () => {
    const long = Array.from({ length: 400 }, (_, i) => message("user", `message ${i} ${"x".repeat(300)}`));
    const transcript = serializeThreadTranscript(long);
    expect(transcript.length).toBeLessThan(60_000);
    expect(transcript.startsWith("_[earlier messages truncated]_")).toBe(true);
  });
});

describe("buildForkContextPrompt", () => {
  it("wraps the transcript with hand-off framing and markers", () => {
    const prompt = buildForkContextPrompt({
      transcript: "**User:**\nhi",
      sourceTitle: "My thread",
      sourceProviderDisplayName: "Claude",
    });
    expect(prompt).toContain('titled "My thread"');
    expect(prompt).toContain("originally handled by Claude");
    expect(prompt).toContain("--- BEGIN FORKED CONVERSATION ---");
    expect(prompt).toContain("--- END FORKED CONVERSATION ---");
    expect(prompt).toContain("**User:**\nhi");
  });
});
