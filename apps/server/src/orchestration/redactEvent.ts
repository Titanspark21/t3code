/**
 * redactEvent — strip sensitive fields from orchestration events at the
 * persistence/broadcast boundary.
 *
 * After upstream's PR #2277 the contract for provider start options
 * collapsed: there is no longer a typed `ProviderStartOptions` envelope
 * with per-driver subfields like `opencode.password`. The new
 * `providerInstances` map carries credentials inside opaque `config`
 * blobs that don't appear on event payloads. This module therefore is now
 * a passthrough; callers may still wrap events through it so we have a
 * single boundary point if/when sensitive fields reappear.
 *
 * TODO(sync): once the fork's adapters are reimplemented as drivers and
 * we know which credentials (if any) bleed into thread events, restore
 * the field-by-field redaction.
 */
import type { OrchestrationEvent } from "@t3tools/contracts";

export function redactEventForBoundary<T extends Omit<OrchestrationEvent, "sequence">>(
  event: T,
): T {
  return event;
}
