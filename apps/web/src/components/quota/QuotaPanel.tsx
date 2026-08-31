import { isQuotaSnapshotStale } from "@t3tools/contracts/quota";
import type { QuotaWindow } from "@t3tools/contracts/quota";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useEnvironments } from "../../state/environments";
import { useQuota } from "../../state/quota";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Gemini, type Icon } from "../Icons";
import { formatQuotaResetAtGlance, quotaRemainingPercent } from "./quotaFormat";
import {
  antigravityAggregateResetLabel,
  antigravityQuotaWindow,
  averageAntigravityQuotaWindow,
  groupAccountsByIdentity,
  groupQuotaPanelAccounts,
  quotaWindowForKind,
} from "./quotaAggregation";
import { ProviderQuotaTooltip } from "./ProviderQuotaTooltip";

/**
 * One grid template for every row in the panel.
 *
 * The three row kinds — Codex/Claude, the Antigravity aggregate, and the
 * expanded per-account rows — previously each declared their own columns, so
 * their figures did not line up and the metrics were pinned to a narrow fixed
 * width regardless of how much room the sidebar had. The metric columns are
 * fractional so they grow with the panel; the trailing column reserves the
 * disclosure chevron's width on rows that do not have one, which is what keeps
 * the three kinds aligned with each other.
 */
const QUOTA_ROW_GRID =
  "grid grid-cols-[minmax(0,1.15fr)_minmax(4.5rem,1fr)_minmax(4.5rem,1fr)_0.75rem] items-center gap-2";

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
  const [antigravityExpanded, setAntigravityExpanded] = useState(false);
  const initialRefreshKey = useRef<string | null>(null);

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

  const rows = useMemo(
    () =>
      groupQuotaPanelAccounts(accounts).filter(
        (row) =>
          row.account.instance.driverKind === "codex" ||
          row.account.instance.driverKind === "claudeAgent" ||
          row.account.instance.driverKind === "antigravity",
      ),
    [accounts],
  );
  const standardAccounts = useMemo(
    () =>
      rows
        .map((row) => row.account)
        .filter(
          (account) =>
            account.instance.driverKind === "codex" ||
            account.instance.driverKind === "claudeAgent",
        ),
    [rows],
  );
  const antigravityAccounts = useMemo(
    () =>
      rows
        .map((row) => row.account)
        .filter((account) => account.instance.driverKind === "antigravity"),
    [rows],
  );

  // Instances that turn out to be the same Antigravity account collapse into
  // one entry. Without this the panel repeats a single account's usage once per
  // configured instance and calls the result several accounts.
  const antigravityGroups = useMemo(
    () => groupAccountsByIdentity(antigravityAccounts),
    [antigravityAccounts],
  );
  const antigravityDistinctAccounts = useMemo(
    () => antigravityGroups.map((group) => group.representative),
    [antigravityGroups],
  );

  // The quota stream includes its current value, but an account that has
  // never reported still needs one provider read. Do this once per configured
  // account set so opening the sidebar does not repeatedly spawn probes.
  const supportedAccountKey = rows.map((row) => row.account.key).join("|");
  useEffect(() => {
    if (
      rows.every((row) => row.account.snapshot !== undefined) ||
      initialRefreshKey.current === supportedAccountKey
    ) {
      return;
    }
    initialRefreshKey.current = supportedAccountKey;
    quota.refresh();
  }, [quota.refresh, rows, supportedAccountKey]);

  if (rows.length === 0) return null;

  return (
    <div className="mb-1 rounded-lg border border-border/65 bg-sidebar-accent/25 p-1.5">
      <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Limits</span>
        <button
          aria-label="Refresh all account limits"
          aria-busy={quota.isRefreshing}
          className="rounded-sm p-0.5 opacity-60 hover:bg-sidebar-accent hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-100"
          disabled={quota.isRefreshing}
          onClick={quota.refresh}
          type="button"
        >
          <RefreshCwIcon
            className={`size-3 ${quota.isRefreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="space-y-2.5">
        {standardAccounts.length > 0 ? (
          <QuotaSection title="Codex & Claude">
            {standardAccounts.map((account) => (
              <StandardQuotaRow account={account} key={account.key} nowMs={nowMs} />
            ))}
          </QuotaSection>
        ) : null}

        {antigravityAccounts.length > 0 ? (
          <QuotaSection title="Antigravity">
            <AntigravityAggregateRow
              accounts={antigravityDistinctAccounts}
              expanded={antigravityExpanded}
              nowMs={nowMs}
              onToggle={() => setAntigravityExpanded((expanded) => !expanded)}
            />
            {antigravityExpanded ? (
              <div className="mt-1 space-y-1 border-t border-border/50 pt-1">
                {antigravityGroups.map((group) => (
                  <AntigravityAccountRow
                    account={group.representative}
                    accountLabel={group.accounts.length > 1 ? group.accountLabel : undefined}
                    key={group.key}
                    name={group.accounts.map((account) => account.instance.displayName).join(", ")}
                    nowMs={nowMs}
                  />
                ))}
              </div>
            ) : null}
          </QuotaSection>
        ) : null}
      </div>
    </div>
  );
});

function QuotaSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-0.5" aria-label={title}>
      <h3 className="px-1 text-[11px] font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const StandardQuotaRow = memo(function StandardQuotaRow({
  account,
  nowMs,
}: {
  account: QuotaPanelAccount;
  nowMs: number;
}) {
  const { instance, snapshot } = account;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[instance.driverKind] ?? null;
  const stale = snapshot ? isQuotaSnapshotStale(snapshot, nowMs) : false;
  const row = (
    <div className={`${QUOTA_ROW_GRID} rounded-md px-1.5 py-1.5 hover:bg-sidebar-accent`}>
      <AccountName account={account} ProviderIcon={ProviderIcon} />
      <QuotaMetric
        label="5h"
        kind="short"
        nowMs={nowMs}
        stale={stale}
        window={quotaWindowForKind(snapshot, "short", nowMs)}
      />
      <QuotaMetric
        label="Week"
        kind="long"
        nowMs={nowMs}
        stale={stale}
        window={quotaWindowForKind(snapshot, "long", nowMs)}
      />
      <span aria-hidden="true" />
    </div>
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

const AntigravityAggregateRow = memo(function AntigravityAggregateRow({
  accounts,
  expanded,
  nowMs,
  onToggle,
}: {
  accounts: ReadonlyArray<QuotaPanelAccount>;
  expanded: boolean;
  nowMs: number;
  onToggle: () => void;
}) {
  const gemini = averageAntigravityQuotaWindow(accounts, "gemini", nowMs);
  const claudeGpt = averageAntigravityQuotaWindow(accounts, "claude-gpt", nowMs);
  const geminiResetLabel = antigravityAggregateResetLabel(accounts, "gemini", nowMs);
  const claudeGptResetLabel = antigravityAggregateResetLabel(accounts, "claude-gpt", nowMs);
  const ProviderIcon = Gemini;

  return (
    <button
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} individual Antigravity account limits`}
      className={`${QUOTA_ROW_GRID} w-full rounded-md px-1.5 py-1.5 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      onClick={onToggle}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ProviderIcon className="size-3.5 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-xs leading-tight">Antigravity</span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {accounts.length} account{accounts.length === 1 ? "" : "s"}
          </span>
        </span>
      </span>
      <QuotaMetric label="Gemini" nowMs={nowMs} resetLabel={geminiResetLabel} window={gemini} />
      <QuotaMetric
        label="Claude + GPT"
        nowMs={nowMs}
        resetLabel={claudeGptResetLabel}
        window={claudeGpt}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className={`size-3 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
      />
    </button>
  );
});

const AntigravityAccountRow = memo(function AntigravityAccountRow({
  account,
  accountLabel,
  name,
  nowMs,
}: {
  account: QuotaPanelAccount;
  /** Shown only when several instances share this account, to explain the merge. */
  accountLabel?: string | undefined;
  name: string;
  nowMs: number;
}) {
  const snapshot = account.snapshot;
  const stale = snapshot ? isQuotaSnapshotStale(snapshot, nowMs) : false;
  const row = (
    <div className={`${QUOTA_ROW_GRID} rounded-md px-1.5 py-1.5`}>
      <span className="min-w-0 pl-5">
        <span className="block truncate text-[11px] text-muted-foreground">{name}</span>
        {accountLabel ? (
          <span className="block truncate text-[9px] leading-tight text-muted-foreground/70">
            {accountLabel}
          </span>
        ) : null}
      </span>
      <QuotaMetric
        label="Gemini"
        nowMs={nowMs}
        stale={stale}
        window={antigravityQuotaWindow(snapshot, "gemini", nowMs)}
      />
      <QuotaMetric
        label="Claude + GPT"
        nowMs={nowMs}
        stale={stale}
        window={antigravityQuotaWindow(snapshot, "claude-gpt", nowMs)}
      />
      <span aria-hidden="true" />
    </div>
  );

  return (
    <ProviderQuotaTooltip
      driverKind={account.instance.driverKind}
      nowMs={nowMs}
      snapshot={snapshot}
      trigger={row}
    />
  );
});

function AccountName({
  account,
  ProviderIcon,
}: {
  account: QuotaPanelAccount;
  ProviderIcon: Icon | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        {ProviderIcon ? <ProviderIcon className="size-3.5" /> : null}
        {account.instance.accentColor ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-sidebar"
            style={{ backgroundColor: account.instance.accentColor }}
          />
        ) : null}
      </span>
      <span className="truncate text-xs leading-tight">{account.instance.displayName}</span>
    </span>
  );
}

function QuotaMetric({
  label,
  kind,
  nowMs,
  resetLabel,
  stale = false,
  window,
}: {
  label: string;
  kind?: QuotaWindow["kind"];
  nowMs: number;
  resetLabel?: string | undefined;
  stale?: boolean;
  window: QuotaWindow | undefined;
}) {
  const remaining = !stale && window ? quotaRemainingPercent(window.usedPercent) : undefined;
  const reset =
    !stale && window
      ? (resetLabel ??
        formatQuotaResetAtGlance(
          window.resetsAt,
          nowMs,
          window.kind === "unknown" ? (kind ?? window.kind) : window.kind,
        ))
      : undefined;
  return (
    <span className="min-w-0 space-y-0.5">
      <span className="flex items-center justify-between gap-1 text-[10px] leading-none text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-foreground/80">
          {stale ? "stale" : remaining === undefined ? "—" : `${remaining}%`}
        </span>
      </span>
      {reset ? (
        <span className="block truncate text-[9px] leading-none text-muted-foreground/80">
          {reset}
        </span>
      ) : null}
      <span className="block h-0.5 overflow-hidden rounded-full bg-foreground/10">
        <span
          className={
            remaining === undefined
              ? "block h-full w-0 rounded-full"
              : `block h-full rounded-full ${
                  remaining <= 10
                    ? "bg-destructive"
                    : remaining <= 30
                      ? "bg-warning"
                      : "bg-foreground/55"
                }`
          }
          style={remaining === undefined ? undefined : { width: `${remaining}%` }}
        />
      </span>
    </span>
  );
}
