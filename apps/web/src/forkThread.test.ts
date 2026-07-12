import { describe, expect, it } from "vite-plus/test";
import {
  buildForkSeedPrompt,
  buildForkThreadTitle,
  buildForkTranscript,
  MAX_FORK_TRANSCRIPT_CHARS,
} from "./forkThread.ts";

type Msg = { role: "user" | "assistant" | "system"; text: string; streaming: boolean };

const msg = (role: Msg["role"], text: string, streaming = false): Msg => ({
  role,
  text,
  streaming,
});

describe("buildForkTranscript", () => {
  it("renders user and assistant turns with speaker labels", () => {
    const transcript = buildForkTranscript([msg("user", "hello"), msg("assistant", "hi there")]);
    expect(transcript).toBe("User: hello\n\nAssistant: hi there");
  });

  it("skips system, streaming, and empty messages", () => {
    const transcript = buildForkTranscript([
      msg("system", "you are helpful"),
      msg("user", "  "),
      msg("assistant", "partial", true),
      msg("user", "real question"),
    ]);
    expect(transcript).toBe("User: real question");
  });

  it("truncates overly long transcripts from the start", () => {
    const huge = "x".repeat(MAX_FORK_TRANSCRIPT_CHARS + 5_000);
    const transcript = buildForkTranscript([msg("assistant", huge)]);
    expect(transcript.length).toBeLessThanOrEqual(MAX_FORK_TRANSCRIPT_CHARS + 40);
    expect(transcript.startsWith("…(earlier messages omitted)…")).toBe(true);
  });
});

describe("buildForkSeedPrompt", () => {
  it("embeds the transcript, source title, and a continue instruction", () => {
    const prompt = buildForkSeedPrompt([msg("user", "q"), msg("assistant", "a")], "My chat");
    expect(prompt).not.toBeNull();
    expect(prompt).toContain('forked from "My chat"');
    expect(prompt).toContain("User: q");
    expect(prompt).toContain("Assistant: a");
    expect(prompt).toContain("--- Prior conversation ---");
  });

  it("returns null when there is nothing to replay", () => {
    expect(buildForkSeedPrompt([], "Empty")).toBeNull();
    expect(buildForkSeedPrompt([msg("system", "sys")], "Only system")).toBeNull();
  });
});

describe("buildForkThreadTitle", () => {
  it("prefixes the source title", () => {
    expect(buildForkThreadTitle("Debug the parser")).toBe("Fork of Debug the parser");
  });

  it("does not stack repeated fork prefixes", () => {
    expect(buildForkThreadTitle("Fork of Debug the parser")).toBe("Fork of Debug the parser");
  });

  it("falls back for an empty title", () => {
    expect(buildForkThreadTitle("   ")).toBe("Fork of chat");
  });
});
