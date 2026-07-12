import { describe, expect, it } from "vite-plus/test";
import {
  GEMINI_SLASH_COMMANDS,
  GEMINI_SLASH_COMMAND_SPECS,
  isNativeGeminiSlashCommand,
  parseSlashCommand,
  renderNativeSlashCommandResponse,
} from "./geminiSlashCommands.ts";

const noStats = {
  messageCount: 0,
  turnCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

describe("GEMINI_SLASH_COMMANDS", () => {
  it("surfaces the curated command set without a leading slash", () => {
    const names = GEMINI_SLASH_COMMANDS.map((command) => command.name);
    expect(names).toContain("help");
    expect(names).toContain("clear");
    expect(names).toContain("stats");
    expect(names.every((name) => !name.startsWith("/"))).toBe(true);
  });

  it("marks help/clear/stats as native and the rest as pass-through", () => {
    const native = GEMINI_SLASH_COMMAND_SPECS.filter((spec) => spec.native).map(
      (spec) => spec.name,
    );
    expect(native.toSorted()).toEqual(["clear", "help", "stats"]);
  });
});

describe("parseSlashCommand", () => {
  it("parses a bare command", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
  });

  it("parses a command with arguments and lower-cases the name", () => {
    expect(parseSlashCommand("/Memory refresh")).toEqual({ name: "memory", args: "refresh" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSlashCommand("   /stats   ")).toEqual({ name: "stats", args: "" });
  });

  it("returns null for normal prompts and malformed commands", () => {
    expect(parseSlashCommand("hello there")).toBeNull();
    expect(parseSlashCommand("/")).toBeNull();
    expect(parseSlashCommand("/123 nope")).toBeNull();
    expect(parseSlashCommand("path/to/file")).toBeNull();
  });
});

describe("isNativeGeminiSlashCommand", () => {
  it("recognizes native commands case-insensitively", () => {
    expect(isNativeGeminiSlashCommand("help")).toBe(true);
    expect(isNativeGeminiSlashCommand("CLEAR")).toBe(true);
    expect(isNativeGeminiSlashCommand("stats")).toBe(true);
  });

  it("rejects pass-through and unknown commands", () => {
    expect(isNativeGeminiSlashCommand("compress")).toBe(false);
    expect(isNativeGeminiSlashCommand("tools")).toBe(false);
    expect(isNativeGeminiSlashCommand("nonsense")).toBe(false);
  });
});

describe("renderNativeSlashCommandResponse", () => {
  it("lists every command for /help", () => {
    const help = renderNativeSlashCommandResponse({ name: "help", args: "" }, noStats);
    expect(help).toBeTruthy();
    for (const spec of GEMINI_SLASH_COMMAND_SPECS) {
      expect(help).toContain(`/${spec.name}`);
    }
  });

  it("confirms a reset for /clear", () => {
    expect(renderNativeSlashCommandResponse({ name: "clear", args: "" }, noStats)).toMatch(
      /cleared/i,
    );
  });

  it("formats token usage for /stats", () => {
    const stats = renderNativeSlashCommandResponse(
      { name: "stats", args: "" },
      { messageCount: 4, turnCount: 2, inputTokens: 1200, outputTokens: 3400, totalTokens: 4600 },
    );
    expect(stats).toContain("4,600");
    expect(stats).toContain("Completed turns: 2");
  });

  it("returns null for non-native commands", () => {
    expect(renderNativeSlashCommandResponse({ name: "tools", args: "" }, noStats)).toBeNull();
  });
});
