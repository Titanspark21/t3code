import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  parseStandaloneUsageCommand,
  resolveProviderSlashCommandAction,
} from "./providerSlashCommandActions";

const codex = ProviderDriverKind.make("codex");
const claude = ProviderDriverKind.make("claudeAgent");
const gemini = ProviderDriverKind.make("geminiCli");

describe("resolveProviderSlashCommandAction", () => {
  it("routes /usage to the usage popup for any provider", () => {
    expect(resolveProviderSlashCommandAction(claude, "usage")).toEqual({ kind: "usage" });
    expect(resolveProviderSlashCommandAction(gemini, "usage")).toEqual({ kind: "usage" });
    expect(resolveProviderSlashCommandAction(codex, "usage")).toEqual({ kind: "usage" });
  });

  it("routes Codex /status to the usage popup but not other providers", () => {
    expect(resolveProviderSlashCommandAction(codex, "status")).toEqual({ kind: "usage" });
    expect(resolveProviderSlashCommandAction(claude, "status")).toBeNull();
  });

  it("expands Codex-only instruction commands to a prompt", () => {
    const review = resolveProviderSlashCommandAction(codex, "review");
    expect(review?.kind).toBe("prompt");
    expect(resolveProviderSlashCommandAction(gemini, "review")).toBeNull();
  });

  it("returns null for pass-through commands like /help", () => {
    expect(resolveProviderSlashCommandAction(gemini, "help")).toBeNull();
  });
});

describe("parseStandaloneUsageCommand", () => {
  it("matches a lone usage command", () => {
    expect(parseStandaloneUsageCommand("/usage", claude)).toBe(true);
    expect(parseStandaloneUsageCommand("  /status  ", codex)).toBe(true);
  });

  it("does not match commands with arguments or other text", () => {
    expect(parseStandaloneUsageCommand("/usage now", claude)).toBe(false);
    expect(parseStandaloneUsageCommand("please /usage", claude)).toBe(false);
    expect(parseStandaloneUsageCommand("/help", gemini)).toBe(false);
    expect(parseStandaloneUsageCommand("/status", claude)).toBe(false);
  });
});
