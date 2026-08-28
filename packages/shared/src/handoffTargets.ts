import type { ModelSelection, ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import { isProviderAvailable, ProviderInstanceId } from "@t3tools/contracts";
import {
  isQuotaSnapshotStale,
  primaryQuotaWindow,
  type AccountQuotaSnapshot,
  type QuotaGroup,
} from "@t3tools/contracts/quota";

/** The states a handoff picker can honestly show for a quota group. */
export type HandoffQuotaStatus = "fresh" | "stale" | "not-exposed" | "no-data";

/**
 * One selectable handoff destination. The visible label is the quota group;
 * provider/account identity is retained only as routing metadata and a
 * secondary explanation, so choosing a destination does not require knowing
 * which provider owns the pool.
 */
export interface HandoffTargetOption {
  readonly key: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly modelSelection: ModelSelection;
  readonly modelName: string;
  readonly accountLabel: string;
  readonly groupKey: string | null;
  readonly groupLabel: string;
  readonly remainingPercent: number | undefined;
  readonly quotaStatus: HandoffQuotaStatus;
}

function providerAccountLabel(provider: ServerProvider): string {
  return provider.displayName?.trim() || provider.instanceId;
}

function modelMatchesGroup(model: ServerProviderModel, group: QuotaGroup): boolean {
  const groupTerms = [group.key, group.displayName]
    .map((value) => value.trim().toLocaleLowerCase())
    .filter((value) => value.length >= 3);
  if (groupTerms.length === 0) return false;

  const modelText = `${model.slug} ${model.name} ${model.subProvider ?? ""}`.toLocaleLowerCase();
  return groupTerms.some((term) => modelText.includes(term));
}

function defaultModel(provider: ServerProvider): ServerProviderModel | undefined {
  return (
    provider.models.find((model) => model.isDefault === true && !model.isCustom) ??
    provider.models.find((model) => !model.isCustom) ??
    provider.models[0]
  );
}

/** Prefer a model that names the selected pool, then preserve the source model when possible. */
function modelForTarget(
  provider: ServerProvider,
  group: QuotaGroup | undefined,
  sourceSelection: ModelSelection,
): { readonly model: ServerProviderModel; readonly preserveSourceOptions: boolean } | undefined {
  const groupModel = group
    ? provider.models.find((model) => modelMatchesGroup(model, group))
    : undefined;
  const sourceModel =
    provider.instanceId === sourceSelection.instanceId
      ? provider.models.find((model) => model.slug === sourceSelection.model)
      : undefined;
  const model = groupModel ?? sourceModel ?? defaultModel(provider);
  return model
    ? {
        model,
        preserveSourceOptions:
          model.slug === sourceSelection.model &&
          provider.instanceId === sourceSelection.instanceId,
      }
    : undefined;
}

function targetSelection(input: {
  readonly provider: ServerProvider;
  readonly group: QuotaGroup | undefined;
  readonly sourceSelection: ModelSelection;
}): { readonly selection: ModelSelection; readonly modelName: string } | undefined {
  const resolved = modelForTarget(input.provider, input.group, input.sourceSelection);
  if (!resolved) return undefined;

  return {
    selection: resolved.preserveSourceOptions
      ? input.sourceSelection
      : { instanceId: input.provider.instanceId, model: resolved.model.slug },
    modelName: resolved.model.name,
  };
}

function quotaForGroup(
  snapshot: AccountQuotaSnapshot | undefined,
  group: QuotaGroup | undefined,
  nowMs: number,
): Pick<HandoffTargetOption, "remainingPercent" | "quotaStatus"> {
  if (!snapshot) return { remainingPercent: undefined, quotaStatus: "no-data" };
  if (isQuotaSnapshotStale(snapshot, nowMs)) {
    return { remainingPercent: undefined, quotaStatus: "stale" };
  }
  const primary = group ? primaryQuotaWindow(group.windows) : undefined;
  if (!primary) return { remainingPercent: undefined, quotaStatus: "not-exposed" };
  return {
    remainingPercent: Math.max(0, Math.min(100, Math.round(100 - primary.usedPercent))),
    quotaStatus: "fresh",
  };
}

function statusRank(option: HandoffTargetOption): number {
  switch (option.quotaStatus) {
    case "fresh":
      return 0;
    case "not-exposed":
      return 1;
    case "no-data":
      return 2;
    case "stale":
      return 3;
  }
}

/**
 * Build the same destination list for web, desktop, and mobile. Every
 * configured account remains selectable when its quota is absent; absence is
 * rendered as a status rather than silently treated as zero or 100%.
 */
export function buildHandoffTargetOptions(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly snapshots: ReadonlyMap<ProviderInstanceId, AccountQuotaSnapshot>;
  readonly sourceSelection: ModelSelection;
  readonly nowMs: number;
}): ReadonlyArray<HandoffTargetOption> {
  const options: Array<{ readonly option: HandoffTargetOption; readonly order: number }> = [];

  input.providers.forEach((provider, providerOrder) => {
    if (
      !provider.enabled ||
      !provider.installed ||
      provider.auth.status === "unauthenticated" ||
      provider.status === "error" ||
      !isProviderAvailable(provider)
    ) {
      return;
    }

    const snapshot = input.snapshots.get(provider.instanceId);
    const groups = snapshot?.groups ?? [];
    const targetGroups: ReadonlyArray<QuotaGroup | undefined> =
      groups.length > 0 ? groups : [undefined];

    targetGroups.forEach((group, groupOrder) => {
      const target = targetSelection({
        provider,
        group,
        sourceSelection: input.sourceSelection,
      });
      if (!target) return;

      const quota = quotaForGroup(snapshot, group, input.nowMs);
      const option: HandoffTargetOption = {
        key: `${provider.instanceId}:${group?.key ?? "account"}`,
        providerInstanceId: provider.instanceId,
        modelSelection: target.selection,
        modelName: target.modelName,
        accountLabel: providerAccountLabel(provider),
        groupKey: group?.key ?? null,
        groupLabel: group?.displayName ?? "Account quota",
        ...quota,
      };
      options.push({ option, order: providerOrder * 10_000 + groupOrder });
    });
  });

  return options
    .sort((left, right) => {
      const statusDifference = statusRank(left.option) - statusRank(right.option);
      if (statusDifference !== 0) return statusDifference;
      if (
        left.option.remainingPercent !== undefined &&
        right.option.remainingPercent !== undefined &&
        left.option.remainingPercent !== right.option.remainingPercent
      ) {
        return right.option.remainingPercent - left.option.remainingPercent;
      }
      return left.order - right.order;
    })
    .map(({ option }) => option);
}
