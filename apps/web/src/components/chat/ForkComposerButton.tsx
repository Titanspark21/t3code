// FILE: ForkComposerButton.tsx
// Purpose: Composer-footer "Fork" control. Opens a dropdown to pick ANY target
// provider instance, model, and reasoning/effort level (independent of the
// current thread's locked provider), then forks the conversation into a new
// linked thread seeded with the full history. Placed next to the Build/Plan
// controls per the composer layout.

import {
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type SelectProviderOptionDescriptor,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  createModelSelection,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import { useMemo, useState } from "react";

import { GitForkIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { getProviderModelCapabilities } from "../../providerModels";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ForkComposerButtonProps {
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  defaultInstanceId: ProviderInstanceId;
  defaultModel: string;
  compact?: boolean;
  disabled?: boolean;
  onFork: (params: {
    modelSelection: ModelSelection;
    provider: ProviderDriverKind;
    instanceId: ProviderInstanceId;
    model: string;
  }) => void;
}

function selectDescriptorsForModel(
  models: ReadonlyArray<ServerProviderModel>,
  modelSlug: string | undefined,
  provider: ProviderDriverKind,
): ReadonlyArray<SelectProviderOptionDescriptor> {
  if (!modelSlug) return [];
  const caps = getProviderModelCapabilities(models, modelSlug, provider);
  return getProviderOptionDescriptors({ caps }).filter(
    (descriptor): descriptor is SelectProviderOptionDescriptor =>
      descriptor.type === "select" && descriptor.options.length > 0,
  );
}

export function ForkComposerButton(props: ForkComposerButtonProps) {
  const { instanceEntries, defaultInstanceId, defaultModel, onFork } = props;
  const [open, setOpen] = useState(false);

  const enabledEntries = useMemo(
    () => instanceEntries.filter((entry) => entry.enabled && entry.models.length > 0),
    [instanceEntries],
  );

  const [instanceId, setInstanceId] = useState<ProviderInstanceId>(defaultInstanceId);
  const [model, setModel] = useState<string>(defaultModel);
  // descriptorId -> chosen value; unset ids fall back to the descriptor default.
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});

  // When the dropdown opens, seed it from the current thread's selection so the
  // common "same provider, new model" and "switch provider" flows both start
  // from a sensible place.
  const resetToDefaults = () => {
    const seedEntry =
      enabledEntries.find((entry) => entry.instanceId === defaultInstanceId) ?? enabledEntries[0];
    setInstanceId(seedEntry?.instanceId ?? defaultInstanceId);
    const seedModel = seedEntry?.models.some((m) => m.slug === defaultModel)
      ? defaultModel
      : (seedEntry?.models[0]?.slug ?? defaultModel);
    setModel(seedModel);
    setOptionValues({});
  };

  const selectedEntry = useMemo(
    () => enabledEntries.find((entry) => entry.instanceId === instanceId),
    [enabledEntries, instanceId],
  );
  const models = selectedEntry?.models ?? [];
  const selectedModel = useMemo(
    () => models.find((m) => m.slug === model) ?? models[0],
    [models, model],
  );
  const descriptors = useMemo(
    () =>
      selectedEntry
        ? selectDescriptorsForModel(
            selectedEntry.models,
            selectedModel?.slug,
            selectedEntry.driverKind,
          )
        : [],
    [selectedEntry, selectedModel],
  );

  const handleInstanceChange = (nextInstanceId: string) => {
    const entry = enabledEntries.find((e) => e.instanceId === nextInstanceId);
    setInstanceId(nextInstanceId as ProviderInstanceId);
    setModel(entry?.models[0]?.slug ?? "");
    setOptionValues({});
  };

  const handleModelChange = (nextModel: string) => {
    setModel(nextModel);
    setOptionValues({});
  };

  const confirmFork = () => {
    if (!selectedEntry || !selectedModel) return;
    const selections: ProviderOptionSelection[] = [];
    for (const descriptor of descriptors) {
      const chosen = optionValues[descriptor.id];
      const value = chosen ?? getProviderOptionCurrentValue(descriptor);
      if (typeof value === "string" && value.length > 0) {
        selections.push({ id: descriptor.id, value });
      }
    }
    const modelSelection = createModelSelection(
      selectedEntry.instanceId,
      selectedModel.slug,
      selections.length > 0 ? selections : null,
    );
    setOpen(false);
    onFork({
      modelSelection,
      provider: selectedEntry.driverKind,
      instanceId: selectedEntry.instanceId,
      model: selectedModel.slug,
    });
  };

  const canFork = enabledEntries.length > 0 && Boolean(selectedEntry) && Boolean(selectedModel);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) resetToDefaults();
        setOpen(next);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              disabled={props.disabled}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 sm:px-3",
              )}
              aria-label="Fork this conversation to another provider or model"
            />
          }
        >
          <GitForkIcon className="size-4" />
          {props.compact ? null : <span className="sr-only sm:not-sr-only">Fork</span>}
        </TooltipTrigger>
        <TooltipPopup side="top">Fork to another provider / model</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="top" align="start" className="w-80" viewportClassName="py-0">
        <div className="grid gap-3 py-4">
          <div className="grid gap-1">
            <span className="font-semibold text-sm text-foreground">Fork conversation</span>
            <span className="text-[11px] text-muted-foreground">
              Replays the full history to a new linked thread on the target you pick.
            </span>
          </div>

          {enabledEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No enabled providers to fork to.</p>
          ) : (
            <>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Provider</span>
                <Select value={instanceId} onValueChange={(value) => handleInstanceChange(value!)}>
                  <SelectTrigger size="sm" className="w-full font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {enabledEntries.map((entry) => (
                      <SelectItem key={entry.instanceId} value={entry.instanceId}>
                        {entry.displayName}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Model</span>
                <Select value={model} onValueChange={(value) => handleModelChange(value!)}>
                  <SelectTrigger size="sm" className="w-full font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {models.map((m) => (
                      <SelectItem key={m.slug} value={m.slug}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>

              {descriptors.map((descriptor) => {
                const value =
                  optionValues[descriptor.id] ??
                  (getProviderOptionCurrentValue(descriptor) as string | undefined) ??
                  descriptor.options[0]?.id ??
                  "";
                return (
                  <label key={descriptor.id} className="grid gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {descriptor.label}
                    </span>
                    <Select
                      value={value}
                      onValueChange={(next) =>
                        setOptionValues((prev) => ({ ...prev, [descriptor.id]: next! }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-full font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {descriptor.options.map((choice) => (
                          <SelectItem key={choice.id} value={choice.id}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </label>
                );
              })}

              <div className="mt-1 flex items-center justify-end gap-2">
                <PopoverClose
                  render={
                    <Button type="button" variant="ghost" size="sm">
                      Cancel
                    </Button>
                  }
                />
                <Button type="button" size="sm" disabled={!canFork} onClick={confirmFork}>
                  <GitForkIcon className="size-3.5" />
                  Fork
                </Button>
              </div>
            </>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
