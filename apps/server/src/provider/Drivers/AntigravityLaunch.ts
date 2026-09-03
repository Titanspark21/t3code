/**
 * Pure launch mapping for Antigravity (`agy`): permission modes to CLI flags,
 * and the `agy models` catalogue to `ServerProviderModel`s.
 *
 * Kept separate from the driver so the two things most likely to be wrong —
 * what permission flag a mode produces, and what happens when the model list
 * changes shape — are testable without spawning anything.
 *
 * @module provider/Drivers/AntigravityLaunch
 */
import type { RuntimeMode } from "@t3tools/contracts";

/**
 * Flags implementing a runtime mode.
 *
 * Verified against `agy --help` at 1.1.5: `--mode accept-edits|plan` exists,
 * `--dangerously-skip-permissions` exists, and there is **no** "ask" flag
 * because asking is the default.
 *
 * ## Why full access sends no flag
 *
 * The obvious mapping for `full-access` is `--dangerously-skip-permissions`,
 * and the previous fork of this project used it. It is the wrong call here.
 *
 * That flag does not mean "approve prompts automatically" — it disables
 * Antigravity's own permission machinery wholesale, including the parts that
 * refuse writes outside the workspace. `full-access` in this app means "do not
 * stop to ask me", not "remove the containment the provider ships with", and
 * conflating those hands an agent more authority than the UI claims to grant.
 *
 * `--mode accept-edits` gets the non-interactive behaviour the mode is actually
 * asking for while leaving the provider's own boundary intact. If a future
 * `agy` grows a real "auto-approve within the workspace" flag, that is the one
 * to adopt — but never the bypass.
 *
 * This is the "extra guardrails for Antigravity" decision recorded in
 * `omni/PLAN.md` item A2.
 */
export function antigravityModeFlags(input: {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode?: "default" | "plan" | undefined;
}): ReadonlyArray<string> {
  // Plan is an explicit interaction mode and outranks the runtime mode: a user
  // asking to plan has not asked for edits, whatever the thread's mode says.
  if (input.interactionMode === "plan") return ["--mode", "plan"];

  switch (input.runtimeMode) {
    case "approval-required":
      // agy asks by default; adding a flag here would only narrow that.
      return [];
    case "auto-accept-edits":
    case "auto":
    case "full-access":
      return ["--mode", "accept-edits"];
  }
}

/** True only for the flag we refuse to emit. Exported so a test can assert it. */
export function isPermissionBypassFlag(flag: string): boolean {
  const normalized = flag.trim().toLowerCase();
  return (
    normalized === "--dangerously-skip-permissions" ||
    normalized === "--yolo" ||
    normalized.startsWith("--dangerously-")
  );
}

/**
 * Strip permission-bypass flags from user-supplied launch arguments.
 *
 * The bridge command and its arguments are user-editable, so the guarantee
 * above is only real if it cannot be undone by pasting a flag into a settings
 * box. Returns the filtered list plus what was removed, so the UI can say it
 * happened rather than silently disagreeing with the user.
 */
export function stripPermissionBypassFlags(args: ReadonlyArray<string>): {
  readonly args: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
} {
  const kept: Array<string> = [];
  const removed: Array<string> = [];
  for (const arg of args) {
    if (isPermissionBypassFlag(arg)) removed.push(arg);
    else kept.push(arg);
  }
  return { args: kept, removed };
}

export interface AntigravityModel {
  readonly slug: string;
  readonly name: string;
  /** Reasoning tier when the model id encodes one, e.g. `-high`. */
  readonly effort?: string;
  /** The quota family published by Antigravity's usage command. */
  readonly family: "google" | "other";
}

export interface AntigravitySelectableModel {
  readonly slug: string;
  readonly name: string;
  readonly family: "google" | "other";
  readonly efforts: ReadonlyArray<string>;
}

export interface AntigravityUsagePayload {
  readonly groups: ReadonlyArray<{
    readonly key: "gemini" | "claude-gpt";
    readonly displayName: string;
    readonly windows: ReadonlyArray<{
      readonly label: string;
      readonly usedPercent: number;
      readonly windowDurationMins: number;
      readonly resetsAt?: string;
    }>;
  }>;
}

const EFFORT_SUFFIXES = ["high", "medium", "low"] as const;

/**
 * Parse the output of `agy models`.
 *
 * Deliberately forgiving about layout and strict about content. `agy` changes
 * fast and is closed-source, so the catalogue is read from the CLI rather than
 * hardcoded — a hardcoded list rots silently, which is worse than an empty one.
 *
 * Accepts one id per line, tolerating bullets, indentation, a trailing
 * description after whitespace or a dash, and decorated headers. Anything that
 * does not look like a model id is dropped rather than guessed at.
 */
export function parseAntigravityModels(stdout: string): ReadonlyArray<AntigravityModel> {
  const seen = new Set<string>();
  const models: Array<AntigravityModel> = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    // Strip common list decoration, then take the first token. The CLI usually
    // separates the slug and its human label with a tab, but accepting any
    // whitespace keeps this compatible with older and redirected output.
    const line = rawLine.trim().replace(/^[-*•\s]+/, "");
    if (line.length === 0) continue;

    const [candidate] = line.split(/[\s\t]+/, 1);
    if (!candidate) continue;

    // Model ids are lowercase slugs: letters, digits, dots and dashes. This
    // rejects headers ("Available models:"), tables and prose without needing
    // to know what those look like.
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const effort = EFFORT_SUFFIXES.find((suffix) => candidate.endsWith(`-${suffix}`));
    const description = line.slice(candidate.length).trim();
    models.push({
      slug: candidate,
      name: description || antigravityModelDisplayName(candidate),
      family: candidate.startsWith("gemini-") ? "google" : "other",
      ...(effort ? { effort } : {}),
    });
  }

  return models;
}

/**
 * Turn provider ids such as `gemini-3.8-flash-high|medium|low` into one model
 * plus an effort selector. The selected effort is joined back onto the exact
 * CLI id at the adapter boundary.
 */
export function collapseAntigravityModelEfforts(
  models: ReadonlyArray<AntigravityModel>,
): ReadonlyArray<AntigravitySelectableModel> {
  const grouped = new Map<
    string,
    {
      readonly slug: string;
      readonly name: string;
      readonly family: "google" | "other";
      readonly efforts: string[];
    }
  >();

  for (const model of models) {
    const baseSlug = model.effort ? model.slug.slice(0, -(model.effort.length + 1)) : model.slug;
    const existing = grouped.get(baseSlug);
    if (existing) {
      if (model.effort && !existing.efforts.includes(model.effort)) {
        existing.efforts.push(model.effort);
      }
      continue;
    }
    grouped.set(baseSlug, {
      slug: baseSlug,
      name: model.effort ? antigravityModelDisplayName(baseSlug) : model.name,
      family: model.family,
      efforts: model.effort ? [model.effort] : [],
    });
  }

  return [...grouped.values()];
}

/**
 * Human label for a model id.
 *
 * `agy --model` resolves models by their id, so the id stays authoritative;
 * this only affects what the picker shows.
 */
export function antigravityModelDisplayName(slug: string): string {
  const gemini = /^gemini-(\d+)[.-](\d+)-(flash|pro)(?:-(high|medium|low))?$/u.exec(slug);
  if (gemini) {
    const major = gemini[1]!;
    const minor = gemini[2]!;
    const family = gemini[3]!;
    const effort = gemini[4];
    return `Gemini ${major}.${minor} ${capitalize(family)}${effort ? ` (${capitalize(effort)})` : ""}`;
  }

  const claude = /^claude-(sonnet|opus)-(\d+)-(\d+)(?:-(thinking))?$/u.exec(slug);
  if (claude) {
    const family = claude[1]!;
    const major = claude[2]!;
    const minor = claude[3]!;
    const thinking = claude[4];
    return `Claude ${capitalize(family)} ${major}.${minor}${thinking ? " (Thinking)" : ""}`;
  }

  const gptOss = /^gpt-oss-(\d+)(b)?(?:-(high|medium|low))?$/u.exec(slug);
  if (gptOss) {
    const size = gptOss[1]!;
    const billions = gptOss[2];
    const effort = gptOss[3];
    return `GPT-OSS ${size}${billions ? "B" : ""}${effort ? ` (${capitalize(effort)})` : ""}`;
  }

  return slug
    .split("-")
    .map((part) => {
      if (/^\d/.test(part)) return part;
      if (part === "gpt" || part === "oss") return part.toUpperCase();
      return capitalize(part);
    })
    .join(" ");
}

/**
 * Parse the tabular output of `agy -p /usage`.
 *
 * Antigravity publishes remaining quota while T3's shared contract stores
 * usage. Keep the conversion here, at the provider boundary, and retain the
 * two independent pools exactly as the CLI reports them.
 */
export function parseAntigravityUsage(stdout: string): AntigravityUsagePayload | undefined {
  const groups = new Map<
    "gemini" | "claude-gpt",
    {
      readonly key: "gemini" | "claude-gpt";
      readonly displayName: string;
      readonly windows: Array<{
        readonly label: string;
        readonly usedPercent: number;
        readonly windowDurationMins: number;
        readonly resetsAt?: string;
      }>;
    }
  >();

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = line.includes("\t")
      ? line.split(/\t+/u).map((field) => field.trim())
      : /^(.+?)\s{2,}(.+?)\s+(\d+(?:\.\d+)?)%\s*(.*)$/u.exec(line)?.slice(1);
    if (!fields || fields.length < 3) continue;

    const displayName = fields[0];
    const label = fields[1];
    const remaining = Number.parseFloat(fields[2]!.replace(/%$/u, ""));
    if (!displayName || !label || !Number.isFinite(remaining)) continue;

    const boundedRemaining = Math.min(100, Math.max(0, remaining));
    const key = /gemini|google/iu.test(displayName) ? "gemini" : "claude-gpt";
    const existing = groups.get(key) ?? {
      key,
      displayName,
      windows: [],
    };
    const windowDurationMins = /five.?hour|5.?hour/iu.test(label)
      ? 300
      : /week|seven.?day/iu.test(label)
        ? 10_080
        : 0;
    if (windowDurationMins === 0) continue;

    const resetCandidate = fields[3]?.trim();
    const resetsAt =
      resetCandidate && !Number.isNaN(Date.parse(resetCandidate)) ? resetCandidate : undefined;
    existing.windows.push({
      label: label.replace(/\s+remaining$/iu, ""),
      usedPercent: 100 - boundedRemaining,
      windowDurationMins,
      ...(resetsAt ? { resetsAt } : {}),
    });
    groups.set(key, existing);
  }

  const parsed = [...groups.values()].filter((group) => group.windows.length > 0);
  return parsed.length > 0 ? { groups: parsed } : undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
