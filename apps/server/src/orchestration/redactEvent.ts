import type { OrchestrationEvent } from "@t3tools/contracts";

/**
 * Redact sensitive fields from an orchestration event payload.
 *
 * Historically this stripped `username`/`password` from opencode and kilo
 * provider options on `thread.turn-start-requested` events. The new
 * orchestration contract no longer carries provider start options on
 * orchestration events (model selection is communicated via `modelSelection`),
 * so there is nothing to redact today. This function is kept as a stable
 * boundary hook so future credential-bearing payloads can be scrubbed in
 * a single place.
 */
export function redactEventForBoundary<T extends Omit<OrchestrationEvent, "sequence">>(
  event: T,
): T {
  return event;
}
