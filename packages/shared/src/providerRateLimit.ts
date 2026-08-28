/**
 * Provider failures that specifically mean "try again after the account
 * window resets".
 *
 * This stays deliberately narrow. A quota snapshot showing 90% usage is
 * useful information, but it is not a turn-start failure and must not make a
 * thread look blocked.
 */

const RATE_LIMIT_PATTERNS = [
  /\brate[\s_-]*limit(?:[\s_-]*(?:exceeded|reached|hit|error))?\b/i,
  /\busage[\s_-]*(?:limit|quota)\b/i,
  /\bquota\b[\s\S]*\b(?:exceeded|reached|limit)\b/i,
  /\b(?:limit|quota)\b[\s\S]*\b(?:exceeded|reached)\b/i,
  /\btoo[\s_-]*many[\s_-]*requests\b/i,
  /\b(?:http[\s_-]*(?:status[\s_-]*)?|status[\s_-]*(?:code[\s_-]*)?)429\b/i,
  /\b429\b/i,
];

export const PROVIDER_RATE_LIMIT_RECOVERY_HINT =
  "Provider usage limit reached. Wait for the provider reset window, then send again.";

export function isProviderRateLimitFailure(detail: string): boolean {
  const normalized = detail.trim();
  return normalized.length > 0 && RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function formatProviderRateLimitFailure(detail: string): string {
  const normalized = detail.trim();
  if (normalized.length === 0) {
    return PROVIDER_RATE_LIMIT_RECOVERY_HINT;
  }
  if (normalized.startsWith(PROVIDER_RATE_LIMIT_RECOVERY_HINT)) {
    return normalized;
  }
  return `${PROVIDER_RATE_LIMIT_RECOVERY_HINT} ${normalized}`;
}
