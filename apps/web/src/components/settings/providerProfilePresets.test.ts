import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getProviderProfilePresets } from "./providerProfilePresets";

describe("provider profile presets", () => {
  it("offers direct CLAUDE_CONFIG_DIR profiles", () => {
    expect(getProviderProfilePresets(ProviderDriverKind.make("claudeAgent"))).toMatchObject([
      { displayName: "Claude 1", config: { configDir: "~/.claude-1" } },
      { displayName: "Claude 2", config: { configDir: "~/.claude-2" } },
    ]);
  });

  it("offers isolated Antigravity profiles instead of the legacy Gemini CLI", () => {
    expect(getProviderProfilePresets(ProviderDriverKind.make("geminiCli"))).toMatchObject([
      {
        displayName: "Antigravity 1",
        config: { antigravity: true, binaryPath: "agy", configDir: "~/.gemini-1" },
      },
      {
        displayName: "Antigravity 2",
        config: { antigravity: true, binaryPath: "agy", configDir: "~/.gemini-2" },
      },
    ]);
  });
});
