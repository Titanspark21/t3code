// FILE: UsageIndicator.tsx
// Purpose: Compact circular usage gauge for the composer footer. Shows the
// most-constrained usage window at a glance and expands, on click, into a
// breakdown of the context window and account rate-limit windows (5h / weekly /
// session) with reset times — mirroring the Claude desktop usage indicator.
// Reads already-collected data so it never sends a turn or blocks a running task.

import { memo } from "react";

import { cn } from "~/lib/utils";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { formatRateLimitResetTime } from "~/lib/rateLimits";
import {
  formatUsageResetRelative,
  type ProviderUsageModel,
  type UsageRateWindow,
} from "~/lib/usageModel";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

/** Tailwind color pair (fill / text) keyed by how close a window is to its cap. */
function severity(usedPercent: number): { bar: string; text: string; stroke: string } {
  if (usedPercent >= 85) {
    return { bar: "bg-red-500", text: "text-red-500", stroke: "stroke-red-500" };
  }
  if (usedPercent >= 60) {
    return { bar: "bg-amber-500", text: "text-amber-500", stroke: "stroke-amber-500" };
  }
  return { bar: "bg-emerald-500", text: "text-emerald-500", stroke: "stroke-emerald-500" };
}

function friendlyWindowLabel(label: string): string {
  switch (label) {
    case "5h":
      return "5-hour limit";
    case "Weekly":
      return "Weekly limit";
    case "Sonnet":
      return "Weekly (Sonnet)";
    case "Session":
      return "Session limit";
    default:
      return `${label} limit`;
  }
}

function UsageGauge(props: { usedPercent: number | null; className?: string }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const clamped = props.usedPercent == null ? 0 : Math.min(100, Math.max(0, props.usedPercent));
  const dash = (clamped / 100) * circumference;
  const tone = props.usedPercent == null ? null : severity(clamped);
  return (
    <svg
      viewBox="0 0 18 18"
      className={cn("size-4 -rotate-90", props.className)}
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        className="stroke-muted-foreground/25"
      />
      {props.usedPercent != null ? (
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={cn("transition-[stroke-dasharray] duration-500", tone?.stroke)}
        />
      ) : null}
    </svg>
  );
}

function UsageBar(props: { usedPercent: number }) {
  const tone = severity(props.usedPercent);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/15">
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", tone.bar)}
        style={{ width: `${Math.min(100, Math.max(2, props.usedPercent))}%` }}
      />
    </div>
  );
}

function UsageRateWindowRow({ window }: { window: UsageRateWindow }) {
  const remaining = Math.round(100 - window.usedPercent);
  const relative = formatUsageResetRelative(window.resetsAt);
  const absolute = window.resetsAt ? formatRateLimitResetTime(window.resetsAt) : null;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{friendlyWindowLabel(window.label)}</span>
        <span className={cn("tabular-nums", severity(window.usedPercent).text)}>
          {remaining}% left
        </span>
      </div>
      <UsageBar usedPercent={window.usedPercent} />
      {relative || absolute ? (
        <span className="text-[11px] text-muted-foreground">
          {relative ?? "resets"}
          {absolute ? ` · ${absolute}` : ""}
        </span>
      ) : null}
    </div>
  );
}

export const UsageIndicator = memo(function UsageIndicator(props: {
  usage: ProviderUsageModel;
  providerDisplayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { usage, providerDisplayName } = props;
  const context = usage.contextWindow;
  const contextUsedPercent = context?.usedPercentage ?? null;

  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
        aria-label="Usage and rate limits"
      >
        <UsageGauge usedPercent={usage.peakUsedPercent} />
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" className="w-80" viewportClassName="py-0">
        <div className="grid gap-3.5 py-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm text-foreground">Usage</span>
            <span className="text-[11px] text-muted-foreground">{providerDisplayName}</span>
          </div>

          {!usage.hasData ? (
            <p className="text-xs text-muted-foreground">
              Usage details appear here after your first message in this thread.
            </p>
          ) : null}

          {context ? (
            <div className="grid gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">Context window</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatContextWindowTokens(context.usedTokens)}
                  {context.maxTokens != null
                    ? ` / ${formatContextWindowTokens(context.maxTokens)}`
                    : ""}
                </span>
              </div>
              {contextUsedPercent != null ? <UsageBar usedPercent={contextUsedPercent} /> : null}
              {context.remainingTokens != null ? (
                <span className="text-[11px] text-muted-foreground">
                  {formatContextWindowTokens(context.remainingTokens)} tokens remaining
                </span>
              ) : null}
            </div>
          ) : null}

          {usage.rateWindows.map((window) => (
            <UsageRateWindowRow key={window.id} window={window} />
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
});
