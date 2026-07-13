// FILE: usageModel.ts
// Purpose: Derives a single, presentation-ready usage model for a thread's
// provider by combining the context-window snapshot with the account
// rate-limit windows (5h / weekly / session) that providers stream during a
// turn. Powers the composer usage indicator and the on-demand usage popup so
// the user can see usage without sending a `/usage` or `/status` turn.

import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { deriveLatestContextWindowSnapshot, type ContextWindowSnapshot } from "./contextWindow";
import {
  deriveAccountRateLimits,
  deriveVisibleRateLimitRows,
  type VisibleRateLimitRow,
} from "./rateLimits";

export interface UsageRateWindow {
  readonly id: string;
  readonly label: string;
  /** 0-100, how much of the window has been consumed. */
  readonly usedPercent: number;
  readonly resetsAt?: string;
  readonly windowDurationMins?: number;
}

export interface ProviderUsageModel {
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly rateWindows: ReadonlyArray<UsageRateWindow>;
  /** Highest utilization across context + rate windows (0-100), for the gauge. */
  readonly peakUsedPercent: number | null;
  readonly hasData: boolean;
  readonly updatedAt: string | null;
}

const EMPTY_USAGE_MODEL: ProviderUsageModel = {
  contextWindow: null,
  rateWindows: [],
  peakUsedPercent: null,
  hasData: false,
  updatedAt: null,
};

function rowToWindow(row: VisibleRateLimitRow): UsageRateWindow {
  return {
    id: row.id,
    label: row.label,
    usedPercent: Math.min(100, Math.max(0, 100 - row.remainingPercent)),
    ...(row.resetsAt ? { resetsAt: row.resetsAt } : {}),
    ...(typeof row.windowDurationMins === "number"
      ? { windowDurationMins: row.windowDurationMins }
      : {}),
  };
}

/**
 * Build the usage model for a single thread's activities. Rate limits are
 * account-scoped but stream on the thread's turns, so the active thread carries
 * the freshest data for its provider.
 */
export function deriveProviderUsageModel(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
): ProviderUsageModel {
  if (!activities || activities.length === 0) {
    return EMPTY_USAGE_MODEL;
  }

  const contextWindow = deriveLatestContextWindowSnapshot(activities);
  const rateWindows = deriveVisibleRateLimitRows(deriveAccountRateLimits([{ activities }])).map(
    rowToWindow,
  );

  const usedPercents: number[] = [];
  if (contextWindow?.usedPercentage != null) {
    usedPercents.push(contextWindow.usedPercentage);
  }
  for (const window of rateWindows) {
    usedPercents.push(window.usedPercent);
  }

  const peakUsedPercent = usedPercents.length > 0 ? Math.max(...usedPercents) : null;
  const hasData = contextWindow !== null || rateWindows.length > 0;

  return {
    contextWindow,
    rateWindows,
    peakUsedPercent,
    hasData,
    updatedAt: contextWindow?.updatedAt ?? null,
  };
}

/**
 * Human-readable "resets in …" string. Prefers a compact relative form for
 * near resets (e.g. "resets in 2h 15m") and falls back to nothing for
 * already-past or missing timestamps.
 */
export function formatUsageResetRelative(resetsAt: string | undefined): string | null {
  if (!resetsAt) return null;
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) return null;
  const diffMs = resetMs - Date.now();
  if (diffMs <= 0) return null;

  const totalMinutes = Math.ceil(diffMs / 60_000);
  if (totalMinutes < 60) {
    return `resets in ${totalMinutes}m`;
  }
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `resets in ${days}d ${hours}h` : `resets in ${days}d`;
  }
  return minutes > 0 ? `resets in ${hours}h ${minutes}m` : `resets in ${hours}h`;
}
