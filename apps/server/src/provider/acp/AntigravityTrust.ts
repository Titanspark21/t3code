import type * as EffectAcpSchema from "effect-acp/schema";

/**
 * Antigravity may represent its first-run project trust dialog as an ACP
 * permission request. It is intentionally detected conservatively: only a
 * request whose serialized content mentions both trust and a project-like
 * workspace is held for the user. Ordinary command approvals keep the normal
 * runtime-mode behavior.
 */
export function isAntigravityProjectTrustRequest(
  request: EffectAcpSchema.RequestPermissionRequest,
): boolean {
  let searchable: string;
  try {
    searchable = JSON.stringify(request).toLowerCase();
  } catch {
    return false;
  }

  return (
    /\btrust(?:ed|ing)?\b/.test(searchable) &&
    /\b(?:project|workspace|folder|directory|contents|codebase)\b/.test(searchable)
  );
}
