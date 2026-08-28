import { describe, expect, it } from "vite-plus/test";

import {
  formatProviderRateLimitFailure,
  isProviderRateLimitFailure,
  PROVIDER_RATE_LIMIT_RECOVERY_HINT,
} from "./providerRateLimit.js";

describe("provider rate-limit classification", () => {
  it.each([
    "HTTP 429 from provider",
    "rate_limit_exceeded",
    "Usage limit reached; resets at 12:00 UTC",
    "quota exceeded for this account",
    "too many requests",
  ])("recognizes explicit limit signal: %s", (detail) => {
    expect(isProviderRateLimitFailure(detail)).toBe(true);
  });

  it.each([
    "90% of the five-hour window used",
    "The provider returned an unexpected response",
    "request failed while reading the response",
    "",
  ])("does not classify non-terminal usage/error text: %s", (detail) => {
    expect(isProviderRateLimitFailure(detail)).toBe(false);
  });

  it("adds a retry-after-reset instruction without duplicating it", () => {
    expect(formatProviderRateLimitFailure("HTTP 429")).toBe(
      `${PROVIDER_RATE_LIMIT_RECOVERY_HINT} HTTP 429`,
    );
    expect(formatProviderRateLimitFailure(PROVIDER_RATE_LIMIT_RECOVERY_HINT)).toBe(
      PROVIDER_RATE_LIMIT_RECOVERY_HINT,
    );
    expect(formatProviderRateLimitFailure("   ")).toBe(PROVIDER_RATE_LIMIT_RECOVERY_HINT);
  });
});
