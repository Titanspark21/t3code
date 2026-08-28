import { describe, expect, it } from "@effect/vitest";

import { ProviderDriverKind } from "@t3tools/contracts";

import { getProviderProfilePresets } from "./providerProfilePresets";

describe("getProviderProfilePresets", () => {
  it("provides three isolated Antigravity account profiles", () => {
    const presets = getProviderProfilePresets(ProviderDriverKind.make("antigravity"));

    expect(presets.map((preset) => preset.label)).toEqual([
      "Antigravity 1",
      "Antigravity 2",
      "Antigravity 3",
    ]);
    expect(presets.map((preset) => preset.config.profileDir)).toEqual([
      "~/.gemini-1",
      "~/.gemini-2",
      "~/.gemini-3",
    ]);
  });

  it("does not add profiles to unrelated providers", () => {
    expect(getProviderProfilePresets(ProviderDriverKind.make("codex"))).toEqual([]);
  });
});
