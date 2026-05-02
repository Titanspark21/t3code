/**
 * providerKind — fork-local helpers for normalizing legacy provider names
 * read from disk against the set of driver kinds this build knows about.
 *
 * Upstream's PR #2277 split the historical "provider kind" into branded
 * `ProviderDriverKind` (driver implementation) and `ProviderInstanceId`
 * (user-defined routing key). The fork keeps this normalizer because some
 * persisted projection rows still carry historical provider names that
 * need to be coerced before they enter routing logic. Instance ids are
 * resolved separately by the persistence boundary.
 */
import { ProviderDriverKind } from "@t3tools/contracts";

const PROVIDER_KINDS = [
  "codex",
  "copilot",
  "claudeAgent",
  "cursor",
  "opencode",
  "geminiCli",
  "amp",
  "kilo",
] as const;

const LEGACY_PROVIDER_KIND_ALIASES: Record<string, string> = {
  claudeCode: "claudeAgent",
  gemini: "geminiCli",
};

const PROVIDER_KIND_SET = new Set<string>(PROVIDER_KINDS);

export function normalizePersistedProviderKindName(
  providerName: string,
): ProviderDriverKind | null {
  const normalized = LEGACY_PROVIDER_KIND_ALIASES[providerName] ?? providerName;
  if (!PROVIDER_KIND_SET.has(normalized)) return null;
  return ProviderDriverKind.make(normalized);
}
