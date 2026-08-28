import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import type { AccountQuotaSnapshot } from "@t3tools/contracts/quota";
import { describe, expect, it } from "vite-plus/test";

import { buildHandoffTargetOptions } from "./handoffTargets.ts";

const NOW = Date.parse("2026-08-28T12:00:00.000Z");

function provider(input: {
  readonly instanceId: string;
  readonly driver?: string;
  readonly models?: ReadonlyArray<ServerProvider["models"][number]>;
  readonly status?: ServerProvider["status"];
  readonly authStatus?: ServerProvider["auth"]["status"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver ?? "codex"),
    displayName: input.instanceId,
    enabled: true,
    installed: true,
    version: null,
    status: input.status ?? "ready",
    auth: { status: input.authStatus ?? "authenticated" },
    checkedAt: "2026-08-28T11:59:00.000Z",
    models: input.models ?? [
      {
        slug: "default-model",
        name: "Default model",
        isCustom: false,
        isDefault: true,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  };
}

function snapshot(
  instanceId: string,
  groups: AccountQuotaSnapshot["groups"],
  observedAt = "2026-08-28T11:00:00.000Z",
): AccountQuotaSnapshot {
  return {
    providerInstanceId: ProviderInstanceId.make(instanceId),
    groups,
    source: "provider-event",
    observedAt,
  };
}

function model(
  slug: string,
  name: string,
  subProvider?: string,
  isDefault = false,
): ServerProvider["models"][number] {
  return {
    slug,
    name,
    ...(subProvider ? { subProvider } : {}),
    isCustom: false,
    ...(isDefault ? { isDefault: true } : {}),
    capabilities: null,
  };
}

const sourceSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "default-model",
  options: [{ id: "reasoningEffort", value: "high" }],
};

describe("buildHandoffTargetOptions", () => {
  it("lists quota groups by remaining capacity and maps groups to matching models", () => {
    const providers = [
      provider({
        instanceId: "antigravity",
        driver: "antigravity",
        models: [
          model("gemini-pro", "Gemini Pro", "gemini", true),
          model("claude-sonnet", "Claude Sonnet", "claude"),
        ],
      }),
    ];
    const quota = snapshot("antigravity", [
      {
        key: "gemini",
        displayName: "Gemini pool",
        windows: [{ kind: "short", usedPercent: 90 }],
      },
      {
        key: "claude",
        displayName: "Claude pool",
        windows: [{ kind: "long", usedPercent: 20 }],
      },
    ]);

    const options = buildHandoffTargetOptions({
      providers,
      snapshots: new Map([[quota.providerInstanceId, quota]]),
      sourceSelection,
      nowMs: NOW,
    });

    expect(options.map((option) => [option.groupLabel, option.remainingPercent])).toEqual([
      ["Claude pool", 80],
      ["Gemini pool", 10],
    ]);
    expect(options.map((option) => option.modelSelection.model)).toEqual([
      "claude-sonnet",
      "gemini-pro",
    ]);
  });

  it("keeps selectable accounts honest when quota is absent or stale", () => {
    const providers = [provider({ instanceId: "no-data" }), provider({ instanceId: "stale" })];
    const staleQuota = snapshot(
      "stale",
      [{ key: "default", displayName: "Weekly", windows: [{ kind: "long", usedPercent: 5 }] }],
      "2026-08-27T00:00:00.000Z",
    );

    const options = buildHandoffTargetOptions({
      providers,
      snapshots: new Map([[staleQuota.providerInstanceId, staleQuota]]),
      sourceSelection,
      nowMs: NOW,
    });

    expect(options.map((option) => [option.accountLabel, option.quotaStatus])).toEqual([
      ["no-data", "no-data"],
      ["stale", "stale"],
    ]);
    expect(options.every((option) => option.remainingPercent === undefined)).toBe(true);
  });

  it("preserves source options when the source account and model remain selected", () => {
    const selection = {
      ...sourceSelection,
      instanceId: ProviderInstanceId.make("codex"),
    };
    const options = buildHandoffTargetOptions({
      providers: [provider({ instanceId: "codex" })],
      snapshots: new Map(),
      sourceSelection: selection,
      nowMs: NOW,
    });

    expect(options[0]?.modelSelection).toEqual(selection);
  });

  it("does not offer disabled, unauthenticated, unavailable, or errored accounts", () => {
    const disabled = { ...provider({ instanceId: "disabled" }), enabled: false };
    const unauthenticated = provider({
      instanceId: "unauthenticated",
      authStatus: "unauthenticated",
    });
    const errored = provider({ instanceId: "errored", status: "error" });
    const options = buildHandoffTargetOptions({
      providers: [
        disabled,
        unauthenticated,
        errored,
        { ...provider({ instanceId: "missing-driver" }), availability: "unavailable" },
      ],
      snapshots: new Map(),
      sourceSelection,
      nowMs: NOW,
    });

    expect(options).toHaveLength(0);
  });
});
