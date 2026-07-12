import { describe, expect, it } from "vite-plus/test";
import {
  ANTIGRAVITY_EFFORT_OPTION_ID,
  ANTIGRAVITY_MODEL_DEFS,
  resolveAntigravityCliModel,
} from "./antigravityModels.ts";

describe("ANTIGRAVITY_MODEL_DEFS", () => {
  it("keeps the effort id aligned with Claude/Codex", () => {
    expect(ANTIGRAVITY_EFFORT_OPTION_ID).toBe("effort");
  });

  it("splits Gemini 3.5 Flash into low/medium/high with medium default", () => {
    const flash = ANTIGRAVITY_MODEL_DEFS.find((def) => def.slug === "Gemini 3.5 Flash");
    expect(flash?.efforts?.map((effort) => effort.value)).toEqual(["low", "medium", "high"]);
    expect(flash?.efforts?.find((effort) => effort.isDefault)?.value).toBe("medium");
  });

  it("splits Gemini 3.1 Pro into low/high with high default", () => {
    const pro = ANTIGRAVITY_MODEL_DEFS.find((def) => def.slug === "Gemini 3.1 Pro");
    expect(pro?.efforts?.map((effort) => effort.value)).toEqual(["low", "high"]);
    expect(pro?.efforts?.find((effort) => effort.isDefault)?.value).toBe("high");
  });

  it("leaves non-effort models (auto, Claude, GPT-OSS) without effort levels", () => {
    for (const slug of [
      "auto",
      "Claude Sonnet 4.6 (Thinking)",
      "Claude Opus 4.6 (Thinking)",
      "GPT-OSS 120B (Medium)",
    ]) {
      const def = ANTIGRAVITY_MODEL_DEFS.find((entry) => entry.slug === slug);
      expect(def, slug).toBeDefined();
      expect(def?.efforts, slug).toBeUndefined();
    }
  });
});

describe("resolveAntigravityCliModel", () => {
  it("expands a base model + effort into the labeled agy --model argument", () => {
    expect(resolveAntigravityCliModel("Gemini 3.5 Flash", "high")).toBe("Gemini 3.5 Flash (High)");
    expect(resolveAntigravityCliModel("Gemini 3.5 Flash", "low")).toBe("Gemini 3.5 Flash (Low)");
    expect(resolveAntigravityCliModel("Gemini 3.1 Pro", "low")).toBe("Gemini 3.1 Pro (Low)");
  });

  it("falls back to the model's default effort when none is selected", () => {
    expect(resolveAntigravityCliModel("Gemini 3.5 Flash", undefined)).toBe(
      "Gemini 3.5 Flash (Medium)",
    );
    expect(resolveAntigravityCliModel("Gemini 3.1 Pro", undefined)).toBe("Gemini 3.1 Pro (High)");
  });

  it("falls back to the default effort when the selection is unknown", () => {
    expect(resolveAntigravityCliModel("Gemini 3.5 Flash", "bogus")).toBe(
      "Gemini 3.5 Flash (Medium)",
    );
  });

  it("passes through auto, single-effort models, and custom slugs unchanged", () => {
    expect(resolveAntigravityCliModel("auto", "high")).toBe("auto");
    expect(resolveAntigravityCliModel("Claude Opus 4.6 (Thinking)", "high")).toBe(
      "Claude Opus 4.6 (Thinking)",
    );
    expect(resolveAntigravityCliModel("my-custom-model", "low")).toBe("my-custom-model");
  });

  it("passes through already-suffixed legacy labels so old threads keep resolving", () => {
    expect(resolveAntigravityCliModel("Gemini 3.5 Flash (High)", "low")).toBe(
      "Gemini 3.5 Flash (High)",
    );
  });

  it("returns undefined for a missing model", () => {
    expect(resolveAntigravityCliModel(undefined, "high")).toBeUndefined();
  });
});
