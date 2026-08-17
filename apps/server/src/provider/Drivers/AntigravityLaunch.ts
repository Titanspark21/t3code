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
    // Strip common list decoration, then take the first token.
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
    models.push({
      slug: candidate,
      name: antigravityModelDisplayName(candidate),
      ...(effort ? { effort } : {}),
    });
  }

  return models;
}

/**
 * Human label for a model id.
 *
 * `agy --model` resolves models by their id, so the id stays authoritative;
 * this only affects what the picker shows.
 */
export function antigravityModelDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((part) => {
      if (/^\d/.test(part)) return part;
      if (part === "gpt" || part === "oss") return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
