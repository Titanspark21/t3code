import assert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import { kiloDiscoveredToServerModels } from "./KiloProvider.ts";

/**
 * Guards the wire-up of Kilo's previously-dead dynamic model discovery. The
 * end-to-end path (live server query) degrades gracefully and can't be
 * integration-tested here, but this pins the pure mapper that feeds the
 * snapshot: discovered models must become non-custom `ServerProviderModel`s
 * with default capabilities so they render in the picker and dedupe against
 * custom slugs in providerModelsFromSettings.
 */
describe("KiloProvider model discovery mapping", () => {
  it("maps discovered Kilo models to non-custom server models with default capabilities", () => {
    const result = kiloDiscoveredToServerModels([
      { slug: "openai/gpt-5", name: "OpenAI / GPT-5", variants: ["high"], connected: true },
      { slug: "anthropic/claude", name: "Anthropic / Claude", connected: false },
    ]);

    assert.equal(result.length, 2);
    const [first, second] = result;
    if (!first || !second) {
      assert.fail("expected two mapped models");
    }

    assert.equal(first.slug, "openai/gpt-5");
    assert.equal(first.name, "OpenAI / GPT-5");
    assert.equal(first.isCustom, false);
    assert.ok(first.capabilities, "discovered models carry default capabilities");
    assert.equal(second.slug, "anthropic/claude");
    assert.equal(second.isCustom, false);
  });

  it("returns an empty list when nothing is discovered", () => {
    assert.deepEqual(kiloDiscoveredToServerModels([]), []);
  });
});
