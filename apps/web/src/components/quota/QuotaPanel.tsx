import { primaryQuotaWindow, isQuotaSnapshotStale } from "@t3tools/contracts/quota";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useEnvironments } from "../../state/environments";
import { useQuota } from "../../state/quota";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Gemini } from "../Icons";
import { formatQuotaAge, quotaRemainingPercent } from "./quotaFormat";
import {
  accountQuotaRemainingPercent,
  groupQuotaPanelAccounts,
  summarizeAntigravityQuota,
} from "./quotaAggregation";
import { ProviderQuotaTooltip } from "./ProviderQuotaTooltip";

interface QuotaPanelAccount {
  readonly key: string;
  readonly environmentLabel: string;
  readonly showEnvironment: boolean;
  readonly instance: ReturnType<typeof deriveProviderInstanceEntries>[number];
  readonly snapshot: ReturnType<typeof useQuota>["snapshots"][number]["snapshot"] | undefined;
}

export const QuotaPanel = memo(function QuotaPanel() {
  const { environments } = useEnvironments();
  const quota = useQuota();
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);

  const accounts = useMemo(() => {
    const showEnvironment = environments.length > 1;
    const rows: QuotaPanelAccount[] = [];
    for (const environment of environments) {
      const snapshots = quota.byEnvironment.get(environment.environmentId);
      for (const instance of deriveProviderInstanceEntries(
        environment.serverConfig?.providers ?? [],
      )) {
        if (!instance.enabled) continue;
        rows.push({
          key: `${environment.environmentId}:${instance.instanceId}`,
          environmentLabel: environment.label,
          showEnvironment,
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
        <RefreshCwIcon className="size-2.5 opacity-60" aria-hidden="true" />
      </div>
      <div className="space-y-0.5">
        {rows.map((row) =>
          row.kind === "antigravity" ? (
            <AntigravityQuotaPanelRow
              accounts={row.accounts}
              key={row.key}
              nowMs={nowMs}
              refresh={quota.refresh}
            />
          ) : (
            <QuotaPanelRow
              account={row.account}
              key={row.account.key}
              nowMs={nowMs}
              refresh={quota.refresh}
            />
          ),
        )}
      </div>
    </div>
  );
});

const AntigravityQuotaPanelRow = memo(function AntigravityQuotaPanelRow({
  accounts,
  nowMs,
  refresh,
}: {
  accounts: ReadonlyArray<QuotaPanelAccount>;
  nowMs: number;
  refresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeAntigravityQuota(accounts, nowMs);
  const status =
    summary.averageRemainingPercent !== undefined
      ? `${summary.averageRemainingPercent}% avg left`
      : summary.accountsWithStaleSnapshots > 0
        ? "Stale"
        : summary.accountsWithSnapshots > 0 && summary.accountsWithExposedWindows === 0
          ? "Not exposed"
          : "No data yet";

  return (
    <div>
      <button
        aria-controls="quota-antigravity-accounts"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} Antigravity account limits`}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          <Gemini className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] leading-tight">Antigravity</span>
          <span className="block truncate text-[9px] leading-tight text-muted-foreground">
            {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{status}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : undefined }}
        />
      </button>
      {expanded ? (
        <div
          className="mb-0.5 ml-6 space-y-0.5 border-l border-border/60 pl-2"
          id="quota-antigravity-accounts"
          role="list"
        >
          {accounts.map((account) => (
            <AntigravityQuotaAccountRow account={account} key={account.key} nowMs={nowMs} />
          ))}
          <button
            aria-label="Refresh Antigravity limits"
            className="mt-0.5 text-[9px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={refresh}
            type="button"
          >
            Refresh limits
          </button>
        </div>
      ) : null}
    </div>
  );
});

const AntigravityQuotaAccountRow = memo(function AntigravityQuotaAccountRow({
  account,
  nowMs,
}: {
  account: QuotaPanelAccount;
  nowMs: number;
}) {
  const { instance, snapshot } = account;
  const stale = snapshot ? isQuotaSnapshotStale(snapshot, nowMs) : false;
  const remaining = accountQuotaRemainingPercent(snapshot, nowMs);
  const status =
    stale && snapshot
      ? `Stale · ${formatQuotaAge(snapshot.observedAt, nowMs)}`
      : remaining !== undefined
        ? `${remaining}% left`
        : snapshot
          ? "Not exposed"
          : "No data yet";

  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-[10px]" role="listitem">
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-tight">{instance.displayName}</span>
        {account.showEnvironment ? (
          <span className="block truncate text-[9px] leading-tight text-muted-foreground">
            {account.environmentLabel}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{status}</span>
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
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[instance.driverKind] ?? null;
  const stale = snapshot ? isQuotaSnapshotStale(snapshot, nowMs) : false;
  const primary = snapshot
    ? primaryQuotaWindow(snapshot.groups.flatMap((group) => group.windows))
    : undefined;
  const status =
    snapshot && stale
      ? `Stale · ${formatQuotaAge(snapshot.observedAt, nowMs)}`
      : primary
        ? `${quotaRemainingPercent(primary.usedPercent)}% left`
        : instance.driverKind === "codex" || instance.driverKind === "claudeAgent"
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
        {account.showEnvironment ? (
          <span className="block truncate text-[9px] leading-tight text-muted-foreground">
            {account.environmentLabel}
          </span>
        ) : null}
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
