/**
 * Antigravity (`agy`) model catalog + effort resolution.
 *
 * Antigravity exposes several models, some of which have discrete reasoning
 * "effort" levels the CLI selects through a labeled
 * `--model "<Base> (<Effort>)"` argument (verified against `agy models`).
 * T3 Code surfaces those effort levels as a reasoning-effort trait next to the
 * model picker — the same affordance Claude and Codex use — instead of listing
 * every "<Base> (<Effort>)" permutation as its own model.
 *
 * This module is the single source of truth shared by:
 *  - `GeminiCliProvider` — builds the provider snapshot's model list, attaching
 *    an `effort` option descriptor to each effort-capable model.
 *  - `geminiCliServerManager` — resolves the selected base model + effort back
 *    into the composite `agy --model` label at turn time.
 *
 * Keeping both sides driven by `ANTIGRAVITY_MODEL_DEFS` guarantees the trait the
 * UI offers always maps to a model label the CLI actually accepts.
 *
 * @module antigravityModels
 */

export interface AntigravityEffortOption {
  /** Stored trait value; matches the option descriptor `value`. */
  readonly value: string;
  /** Human label shown in the effort menu. */
  readonly label: string;
  /** Suffix appended to the base model to form the `agy --model` label. */
  readonly cliSuffix: string;
  readonly isDefault?: boolean;
}

export interface AntigravityModelDef {
  /** Stored slug / base model — what the composer persists as the model. */
  readonly slug: string;
  /** Display name in the model picker. */
  readonly name: string;
  /**
   * Discrete effort levels. When present, the effective `agy --model` label is
   * `"<slug> (<cliSuffix>)"` for the selected effort; when absent the slug is
   * passed to the CLI verbatim.
   */
  readonly efforts?: ReadonlyArray<AntigravityEffortOption>;
}

/** The reasoning-effort trait id, shared with Claude/Codex for consistency. */
export const ANTIGRAVITY_EFFORT_OPTION_ID = "effort";

const FLASH_EFFORTS: ReadonlyArray<AntigravityEffortOption> = [
  { value: "low", label: "Low", cliSuffix: "Low" },
  { value: "medium", label: "Medium", cliSuffix: "Medium", isDefault: true },
  { value: "high", label: "High", cliSuffix: "High" },
];

const PRO_EFFORTS: ReadonlyArray<AntigravityEffortOption> = [
  { value: "low", label: "Low", cliSuffix: "Low" },
  { value: "high", label: "High", cliSuffix: "High", isDefault: true },
];

/**
 * Antigravity model definitions, in picker order. `Gemini 3.5 Flash` and
 * `Gemini 3.1 Pro` carry effort levels; the remaining entries map 1:1 to a CLI
 * model label.
 */
export const ANTIGRAVITY_MODEL_DEFS: ReadonlyArray<AntigravityModelDef> = [
  { slug: "auto", name: "Antigravity (Automatic)" },
  { slug: "Gemini 3.5 Flash", name: "Gemini 3.5 Flash", efforts: FLASH_EFFORTS },
  { slug: "Gemini 3.1 Pro", name: "Gemini 3.1 Pro", efforts: PRO_EFFORTS },
  { slug: "Claude Sonnet 4.6 (Thinking)", name: "Claude Sonnet 4.6 (Thinking)" },
  { slug: "Claude Opus 4.6 (Thinking)", name: "Claude Opus 4.6 (Thinking)" },
  { slug: "GPT-OSS 120B (Medium)", name: "GPT-OSS 120B (Medium)" },
];

const EFFORT_MODELS_BY_SLUG = new Map<string, AntigravityModelDef>(
  ANTIGRAVITY_MODEL_DEFS.filter((def) => def.efforts && def.efforts.length > 0).map((def) => [
    def.slug,
    def,
  ]),
);

function defaultEffort(def: AntigravityModelDef): AntigravityEffortOption | undefined {
  return def.efforts?.find((effort) => effort.isDefault) ?? def.efforts?.[0];
}

/**
 * Resolve the base model + selected effort into the `agy --model` label.
 *
 * - Effort-capable base models (`Gemini 3.5 Flash`, `Gemini 3.1 Pro`) become
 *   `"<base> (<Effort>)"`, defaulting to the model's default effort when the
 *   selection is missing or unknown.
 * - Every other value — `"auto"`, single-effort models, custom slugs, and
 *   already-suffixed legacy labels such as `"Gemini 3.5 Flash (High)"` — is
 *   returned unchanged so historical threads keep resolving.
 */
export function resolveAntigravityCliModel(
  model: string | undefined,
  effort: string | undefined,
): string | undefined {
  if (!model) return undefined;
  const def = EFFORT_MODELS_BY_SLUG.get(model);
  if (!def) return model;
  const chosen =
    (effort ? def.efforts?.find((option) => option.value === effort) : undefined) ??
    defaultEffort(def);
  return chosen ? `${def.slug} (${chosen.cliSuffix})` : model;
}
