import { describe, expect, it } from "@effect/vitest";

import { ProviderDriverKind } from "@t3tools/contracts";

import { getProviderProfilePresets } from "./providerProfilePresets";

describe("getProviderProfilePresets", () => {
  it("provides five isolated Antigravity account profiles", () => {
    const presets = getProviderProfilePresets(ProviderDriverKind.make("antigravity"));

    expect(presets.map((preset) => preset.label)).toEqual([
      "AGY-1",
      "AGY-2",
      "AGY-3",
      "AGY-4",
      "AGY-5",
    ]);
    expect(presets.map((preset) => preset.config.profileDir)).toEqual([
      "~/.gemini-1",
      "~/.gemini-2",
      "~/.gemini-3",
      "~/.gemini-4",
      "~/.gemini-5",
    ]);
  });

  it("does not add profiles to unrelated providers", () => {
    expect(getProviderProfilePresets(ProviderDriverKind.make("codex"))).toEqual([]);
  });
});
