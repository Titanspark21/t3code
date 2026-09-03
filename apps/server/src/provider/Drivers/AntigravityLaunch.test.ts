import { describe, expect, it } from "@effect/vitest";

import type { RuntimeMode } from "@t3tools/contracts";

import {
  antigravityModelDisplayName,
  antigravityModeFlags,
  collapseAntigravityModelEfforts,
  isPermissionBypassFlag,
  parseAntigravityModels,
  parseAntigravityUsage,
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
    expect(models[0]?.name).toBe("Fast, high reasoning");
    expect(models[0]?.family).toBe("google");
    expect(models[1]?.family).toBe("google");
  });

  it("extracts the reasoning tier baked into the id", () => {
    const models = parseAntigravityModels("gemini-3.5-flash-high\nclaude-sonnet-4-6");
    expect(models[0]?.effort).toBe("high");
    expect(models[1]?.effort).toBeUndefined();
  });

  it("collapses model suffixes into one selectable model with effort choices", () => {
    const models = collapseAntigravityModelEfforts(
      parseAntigravityModels(
        [
          "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
          "gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)",
          "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
          "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
        ].join("\n"),
      ),
    );

    expect(models).toEqual([
      {
        slug: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        family: "google",
        efforts: ["high", "medium", "low"],
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6 (Thinking)",
        family: "other",
        efforts: [],
      },
    ]);
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

  it("preserves the two published usage pools", () => {
    const usage = parseAntigravityUsage(
      [
        "Gemini Models\tWeekly Limit Remaining\t95%\t2026-09-04T04:24:01Z",
        "Gemini Models\tFive Hour Limit Remaining\t93%\t2026-08-30T07:00:01Z",
        "Claude and GPT models\tWeekly Limit Remaining\t30%\t2026-09-01T06:42:57Z",
        "Claude and GPT models\tFive Hour Limit Remaining\t37%\t2026-08-30T07:00:13Z",
      ].join("\n"),
    );
    expect(usage?.groups.map((group) => group.key)).toEqual(["gemini", "claude-gpt"]);
    expect(usage?.groups[0]?.windows[0]).toMatchObject({
      label: "Weekly Limit",
      usedPercent: 5,
      windowDurationMins: 10_080,
    });
    expect(usage?.groups[1]?.windows[1]?.usedPercent).toBe(63);
  });

  it("de-duplicates repeated ids", () => {
    const models = parseAntigravityModels("gemini-3.5-flash-high\ngemini-3.5-flash-high");
    expect(models).toHaveLength(1);
  });
});

describe("antigravityModelDisplayName", () => {
  it("keeps version numbers intact", () => {
    expect(antigravityModelDisplayName("gemini-3.5-flash-high")).toBe("Gemini 3.5 Flash (High)");
  });

  it("uppercases known acronyms", () => {
    expect(antigravityModelDisplayName("gpt-oss-120b-medium")).toBe("GPT-OSS 120B (Medium)");
  });

  it("formats thinking models like the provider picker", () => {
    expect(antigravityModelDisplayName("claude-opus-4-6-thinking")).toBe(
      "Claude Opus 4.6 (Thinking)",
    );
  });
});
