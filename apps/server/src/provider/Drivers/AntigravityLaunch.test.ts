import { describe, expect, it } from "@effect/vitest";

import type { RuntimeMode } from "@t3tools/contracts";

import {
  antigravityModelDisplayName,
  antigravityModeFlags,
  isPermissionBypassFlag,
  parseAntigravityModels,
  stripPermissionBypassFlags,
} from "./AntigravityLaunch.ts";

const ALL_MODES: ReadonlyArray<RuntimeMode> = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

describe("antigravityModeFlags", () => {
  it("sends no flag for approval-required, since agy asks by default", () => {
    expect(antigravityModeFlags({ runtimeMode: "approval-required" })).toEqual([]);
  });

  it("maps the non-interactive modes to accept-edits", () => {
    for (const mode of ["auto-accept-edits", "auto", "full-access"] as const) {
      expect(antigravityModeFlags({ runtimeMode: mode })).toEqual(["--mode", "accept-edits"]);
    }
  });

  it("lets an explicit plan interaction mode outrank the runtime mode", () => {
    expect(antigravityModeFlags({ runtimeMode: "full-access", interactionMode: "plan" })).toEqual([
      "--mode",
      "plan",
    ]);
  });

  it("never emits a permission bypass, for any mode", () => {
    // The guardrail. The previous fork sent --dangerously-skip-permissions for
    // every full-access turn, which disables agy's own containment rather than
    // just suppressing prompts.
    for (const mode of ALL_MODES) {
      for (const interactionMode of ["default", "plan"] as const) {
        const flags = antigravityModeFlags({ runtimeMode: mode, interactionMode });
        expect(flags.some(isPermissionBypassFlag)).toBe(false);
      }
    }
  });
});

describe("stripPermissionBypassFlags", () => {
  it("removes a bypass pasted into user-editable launch arguments", () => {
    const result = stripPermissionBypassFlags([
      "--acp",
      "--dangerously-skip-permissions",
      "--verbose",
    ]);
    expect(result.args).toEqual(["--acp", "--verbose"]);
    expect(result.removed).toEqual(["--dangerously-skip-permissions"]);
  });

  it("catches casing and future --dangerously- variants", () => {
    const result = stripPermissionBypassFlags([
      "--DANGEROUSLY-SKIP-PERMISSIONS",
      "--dangerously-allow-everything",
      "--yolo",
    ]);
    expect(result.args).toEqual([]);
    expect(result.removed).toHaveLength(3);
  });

  it("leaves ordinary arguments untouched", () => {
    const result = stripPermissionBypassFlags(["--model", "gemini-3.5-flash-high"]);
    expect(result.args).toEqual(["--model", "gemini-3.5-flash-high"]);
    expect(result.removed).toEqual([]);
  });
});

describe("parseAntigravityModels", () => {
  it("reads a plain list", () => {
    const models = parseAntigravityModels(
      ["gemini-3.5-flash-high", "gemini-3.1-pro-low", "claude-sonnet-4-6"].join("\n"),
    );
    expect(models.map((m) => m.slug)).toEqual([
      "gemini-3.5-flash-high",
      "gemini-3.1-pro-low",
      "claude-sonnet-4-6",
    ]);
  });

  it("tolerates bullets, indentation and trailing descriptions", () => {
    const models = parseAntigravityModels(
      [
        "Available models:",
        "  - gemini-3.5-flash-high   Fast, high reasoning",
        "  * gemini-3.1-pro-low - cheaper",
        "",
      ].join("\n"),
    );
    expect(models.map((m) => m.slug)).toEqual(["gemini-3.5-flash-high", "gemini-3.1-pro-low"]);
  });

  it("extracts the reasoning tier baked into the id", () => {
    const models = parseAntigravityModels("gemini-3.5-flash-high\nclaude-sonnet-4-6");
    expect(models[0]?.effort).toBe("high");
    expect(models[1]?.effort).toBeUndefined();
  });

  it("drops prose and headers rather than inventing models", () => {
    const models = parseAntigravityModels(
      ["Available models:", "No models found.", "Usage: agy models", "gemini-3.5-flash-low"].join(
        "\n",
      ),
    );
    expect(models.map((m) => m.slug)).toEqual(["gemini-3.5-flash-low"]);
  });

  it("returns nothing for unrecognized output instead of guessing", () => {
    expect(parseAntigravityModels("")).toEqual([]);
    expect(parseAntigravityModels("Error: not logged in")).toEqual([]);
  });

  it("de-duplicates repeated ids", () => {
    const models = parseAntigravityModels("gemini-3.5-flash-high\ngemini-3.5-flash-high");
    expect(models).toHaveLength(1);
  });
});

describe("antigravityModelDisplayName", () => {
  it("keeps version numbers intact", () => {
    expect(antigravityModelDisplayName("gemini-3.5-flash-high")).toBe("Gemini 3.5 Flash High");
  });

  it("uppercases known acronyms", () => {
    expect(antigravityModelDisplayName("gpt-oss-120b-medium")).toBe("GPT OSS 120b Medium");
  });
});
