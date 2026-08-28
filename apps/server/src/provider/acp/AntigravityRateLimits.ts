/**
 * Extension notification names used by Antigravity ACP bridges for account
 * quota updates. The bridge protocol is not standardized, so the adapter
 * accepts these documented naming families but does not classify arbitrary
 * notifications as quota data.
 */
const RATE_LIMIT_METHODS = new Set([
  "accountratelimitsupdated",
  "agyratelimitsupdated",
  "agyaccountratelimitsupdated",
  "antigravityratelimitsupdated",
  "antigravityaccountratelimitsupdated",
  "ratelimitsupdated",
]);

export function isAntigravityRateLimitsMethod(method: string): boolean {
  return RATE_LIMIT_METHODS.has(
    method
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, ""),
  );
}
