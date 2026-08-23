import type { QuotaWindow } from "@t3tools/contracts/quota";

export function quotaWindowLabel(window: QuotaWindow): string {
  if (window.kind === "short") return "5h";
  if (window.kind === "long") return "Week";
  return window.label ?? "Limit";
}

export function quotaRemainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

export function formatQuotaReset(resetsAt: string | undefined, nowMs: number): string {
  if (!resetsAt) return "Reset not exposed";
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) return "Reset unavailable";
  const remainingMs = resetMs - nowMs;
  if (remainingMs <= 0) return "Reset due";

  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 60) return `Resets in ${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Resets in ${hours}h`;
  return `Resets in ${Math.floor(hours / 24)}d`;
}

export function formatQuotaAge(observedAt: string, nowMs: number): string {
  const observedMs = Date.parse(observedAt);
  if (Number.isNaN(observedMs)) return "unknown age";
  const minutes = Math.max(0, Math.floor((nowMs - observedMs) / 60_000));
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}
