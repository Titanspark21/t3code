import type { ProviderUsageLimitsUpdate } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcess } from "effect/unstable/process";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { spawnAndCollect } from "../providerSnapshot.ts";

export interface AntigravityUsageWindow {
  readonly label: string;
  readonly usedPercent: number;
  readonly windowDurationMins: number;
  readonly resetsAt?: string;
}

export interface AntigravityUsageGroup {
  readonly key: "gemini" | "claude-gpt";
  readonly displayName: string;
  readonly windows: ReadonlyArray<AntigravityUsageWindow>;
}

export interface AntigravityUsagePayload {
  readonly groups: ReadonlyArray<AntigravityUsageGroup>;
}

export function antigravityUsageToProviderLimits(
  usage: AntigravityUsagePayload,
): ProviderUsageLimitsUpdate {
  return {
    windows: usage.groups.flatMap((group) =>
      group.windows.map((window, index) => ({
        id: `${group.key}-${window.windowDurationMins}-${index}`,
        kind: window.windowDurationMins >= 10_080 ? "weekly" : "session",
        label: `${group.displayName} ${window.label}`,
        usedPercent: window.usedPercent,
        ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
        windowDurationMins: window.windowDurationMins,
      })),
    ),
  };
}

function windowDurationMins(value: unknown, fallback?: string): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const text = typeof value === "string" ? value : fallback;
  if (!text) return undefined;
  if (/(?:five.?hour|5.?hour|5h|session)/iu.test(text)) return 300;
  if (/(?:weekly|week|seven.?day|7d)/iu.test(text)) return 10_080;
  return undefined;
}

function remainingToUsed(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) return undefined;
  const remainingPercent = numeric <= 1 ? numeric * 100 : numeric;
  return Math.min(100, Math.max(0, 100 - remainingPercent));
}

function parseReset(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value.trim();
}

function groupKey(displayName: string): "gemini" | "claude-gpt" {
  return /gemini|google/iu.test(displayName) ? "gemini" : "claude-gpt";
}

function parseJsonGroups(value: unknown): AntigravityUsagePayload | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const command = record.command;
  const commandData =
    typeof command === "object" && command !== null
      ? (command as Record<string, unknown>).data
      : undefined;
  const data =
    typeof commandData === "object" && commandData !== null
      ? (commandData as Record<string, unknown>)
      : record;
  const rawGroups = data.groups;
  if (!Array.isArray(rawGroups)) return undefined;

  const groups: AntigravityUsageGroup[] = [];
  for (const rawGroup of rawGroups) {
    if (typeof rawGroup !== "object" || rawGroup === null) continue;
    const group = rawGroup as Record<string, unknown>;
    const displayName = typeof group.name === "string" ? group.name.trim() : "";
    if (!displayName) continue;
    const rawBuckets = group.buckets;
    if (!Array.isArray(rawBuckets)) continue;
    const windows: AntigravityUsageWindow[] = [];
    for (const rawBucket of rawBuckets) {
      if (typeof rawBucket !== "object" || rawBucket === null) continue;
      const bucket = rawBucket as Record<string, unknown>;
      if (bucket.disabled === true) continue;
      const label = typeof bucket.name === "string" ? bucket.name.trim() : "";
      const duration = windowDurationMins(bucket.window, label);
      const usedPercent = remainingToUsed(
        bucket.remaining_fraction ?? bucket.remainingFraction ?? bucket.remaining_percent,
      );
      if (!label || duration === undefined || usedPercent === undefined) continue;
      const reset = parseReset(bucket.reset_time ?? bucket.resetTime ?? bucket.resetsAt);
      windows.push({
        label: label.replace(/\s+remaining$/iu, ""),
        usedPercent,
        windowDurationMins: duration,
        ...(reset ? { resetsAt: reset } : {}),
      });
    }
    if (windows.length > 0) {
      groups.push({ key: groupKey(displayName), displayName, windows });
    }
  }
  return groups.length > 0 ? { groups } : undefined;
}

function parseText(stdout: string): AntigravityUsagePayload | undefined {
  const groups = new Map<"gemini" | "claude-gpt", AntigravityUsageGroup>();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = line.includes("\t")
      ? line.split(/\t+/u).map((field) => field.trim())
      : /^(.+?)\s{2,}(.+?)\s+(\d+(?:\.\d+)?)%\s*(.*)$/u.exec(line)?.slice(1);
    if (!fields || fields.length < 3) continue;
    const displayName = fields[0];
    const label = fields[1];
    const usedPercent = remainingToUsed(fields[2]);
    const duration = windowDurationMins(undefined, label);
    if (!displayName || !label || usedPercent === undefined || duration === undefined) continue;
    const key = groupKey(displayName);
    const existing = groups.get(key) ?? { key, displayName, windows: [] };
    const reset = parseReset(fields[3]);
    groups.set(key, {
      ...existing,
      windows: [
        ...existing.windows,
        {
          label: label.replace(/\s+remaining$/iu, ""),
          usedPercent,
          windowDurationMins: duration,
          ...(reset ? { resetsAt: reset } : {}),
        },
      ],
    });
  }
  const parsed = [...groups.values()];
  return parsed.length > 0 ? { groups: parsed } : undefined;
}

/** Parse both current JSON output and the older tabular `agy /usage` output. */
export function parseAntigravityUsage(stdout: string): AntigravityUsagePayload | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const jsonGroups = parseJsonGroups(parsed);
    if (jsonGroups) return jsonGroups;
    if (typeof parsed === "object" && parsed !== null) {
      const response = (parsed as Record<string, unknown>).response;
      if (typeof response === "string") return parseText(response);
    }
  } catch {
    // The CLI's text mode is intentionally supported as a fallback.
  }
  return parseText(stdout);
}

export const readAntigravityUsage = Effect.fn("readAntigravityUsage")(function* (input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly profileDirectory: string;
}) {
  const environment = {
    ...input.environment,
    GEMINI_HOME: input.profileDirectory,
    AGY_ACP_FORCE_FILE_STORAGE: "1",
  };
  const result = yield* Effect.gen(function* () {
    const resolved = yield* resolveSpawnCommand(
      "agy",
      ["-p", "/usage", "--output-format", "json"],
      {
        env: environment,
        extendEnv: false,
      },
    );
    return yield* spawnAndCollect(
      "agy",
      ChildProcess.make(resolved.command, resolved.args, {
        env: environment,
        extendEnv: false,
        shell: resolved.shell,
      }),
    );
  }).pipe(
    Effect.timeoutOption("20 seconds"),
    Effect.orElseSucceed(() => Option.none()),
  );
  if (Option.isNone(result) || result.value.code !== 0) return undefined;
  return parseAntigravityUsage(result.value.stdout);
});
