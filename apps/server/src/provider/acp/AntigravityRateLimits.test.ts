import { describe, expect, it } from "@effect/vitest";

import { isAntigravityRateLimitsMethod } from "./AntigravityRateLimits.ts";

describe("isAntigravityRateLimitsMethod", () => {
  it("accepts the bridge notification naming variants", () => {
    for (const method of [
      "account/rateLimits/updated",
      "account.rate-limits.updated",
      "agy/account/rate_limits/updated",
      "antigravity/rate-limits/updated",
    ]) {
      expect(isAntigravityRateLimitsMethod(method)).toBe(true);
    }
  });

  it("does not treat unrelated extensions as quota updates", () => {
    expect(isAntigravityRateLimitsMethod("session/update")).toBe(false);
    expect(isAntigravityRateLimitsMethod("agy/models/updated")).toBe(false);
  });
});
