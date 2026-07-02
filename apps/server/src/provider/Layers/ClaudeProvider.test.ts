import { describe, expect, it } from "vite-plus/test";

import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import { getBuiltInClaudeModelsForVersion, getClaudeModelCapabilities } from "./ClaudeProvider.js";

describe("ClaudeProvider", () => {
  it("gates Claude Sonnet 5 on the minimum Claude Code version", () => {
    expect(
      getBuiltInClaudeModelsForVersion("2.1.196").map(
        (model: { readonly slug: string }) => model.slug,
      ),
    ).not.toContain("claude-sonnet-5");
    expect(
      getBuiltInClaudeModelsForVersion("2.1.197").map(
        (model: { readonly slug: string }) => model.slug,
      ),
    ).toContain("claude-sonnet-5");
  });

  it("treats Claude Sonnet 5 as a native 1M model without a context selector", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: getClaudeModelCapabilities("claude-sonnet-5"),
    });

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(["effort"]);
  });
});
