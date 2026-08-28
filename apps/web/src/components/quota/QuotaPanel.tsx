import { primaryQuotaWindow, isQuotaSnapshotStale } from "@t3tools/contracts/quota";
import { RefreshCwIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useEnvironments } from "../../state/environments";
import { useQuota } from "../../state/quota";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Gemini } from "../Icons";
import { formatQuotaAge, quotaRemainingPercent } from "./quotaFormat";
import { accountQuotaRemainingPercent, groupQuotaPanelAccounts } from "./quotaAggregation";
import { ProviderQuotaTooltip } from "./ProviderQuotaTooltip";

interface QuotaPanelAccount {
  readonly key: string;
  readonly instance: ReturnType<typeof deriveProviderInstanceEntries>[number];
  readonly snapshot: ReturnType<typeof useQuota>["snapshots"][number]["snapshot"] | undefined;
}

export const QuotaPanel = memo(function QuotaPanel() {
  const { environments } = useEnvironments();
  const quota = useQuota();
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);

  const accounts = useMemo(() => {
    const rows: QuotaPanelAccount[] = [];
    for (const environment of environments) {
      const snapshots = quota.byEnvironment.get(environment.environmentId);
      for (const instance of deriveProviderInstanceEntries(
        environment.serverConfig?.providers ?? [],
      )) {
        if (!instance.enabled) continue;
        rows.push({
          key: `${environment.environmentId}:${instance.instanceId}`,
          instance,
          snapshot: snapshots?.get(instance.instanceId),
        });
      }
    }
    return rows;
  }, [environments, quota.byEnvironment]);
  const rows = useMemo(() => groupQuotaPanelAccounts(accounts), [accounts]);

  if (accounts.length === 0) return null;

  return (
    <div className="mb-1 rounded-lg border border-border/65 bg-sidebar-accent/25 p-1.5">
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Limits</span>
        <button
          aria-label="Refresh all account limits"
          className="rounded-sm p-0.5 opacity-60 hover:bg-sidebar-accent hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={quota.refresh}
          type="button"
        >
          <RefreshCwIcon className="size-2.5" aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <QuotaPanelRow
            account={row.account}
            key={row.account.key}
            nowMs={nowMs}
            refresh={quota.refresh}
          />
        ))}
      </div>
    </div>
  );
});

const QuotaPanelRow = memo(function QuotaPanelRow({
  account,
  nowMs,
  refresh,
}: {
  account: QuotaPanelAccount;
  nowMs: number;
  refresh: () => void;
}) {
  const { instance, snapshot } = account;
  const ProviderIcon =
    PROVIDER_ICON_BY_PROVIDER[instance.driverKind] ??
    (instance.driverKind === "antigravity" ? Gemini : null);
  const stale = snapshot ? isQuotaSnapshotStale(snapshot, nowMs) : false;
  const remaining =
    instance.driverKind === "antigravity"
      ? accountQuotaRemainingPercent(snapshot, nowMs)
      : snapshot
        ? (() => {
            const primary = primaryQuotaWindow(snapshot.groups.flatMap((group) => group.windows));
            return primary ? quotaRemainingPercent(primary.usedPercent) : undefined;
          })()
        : undefined;
  const status =
    snapshot && stale
      ? `Stale · ${formatQuotaAge(snapshot.observedAt, nowMs)}`
      : remaining !== undefined
        ? `${remaining}% left`
        : instance.driverKind === "codex" ||
            instance.driverKind === "claudeAgent" ||
            instance.driverKind === "antigravity"
          ? "No data yet"
          : "Not exposed";

  const row = (
    <button
      aria-label={`Refresh limits for ${instance.displayName}`}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={refresh}
      type="button"
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        {ProviderIcon ? <ProviderIcon className="size-3.5" /> : null}
        {instance.accentColor ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-sidebar"
            style={{ backgroundColor: instance.accentColor }}
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] leading-tight">{instance.displayName}</span>
      </span>
      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{status}</span>
    </button>
  );

  return (
    <ProviderQuotaTooltip
      driverKind={instance.driverKind}
      nowMs={nowMs}
      snapshot={snapshot}
      trigger={row}
    />
  );
});
