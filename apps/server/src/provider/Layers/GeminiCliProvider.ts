// @effect-diagnostics globalDate:off globalDateInEffect:off - Provider snapshot DTOs use ISO timestamps.
/**
 * GeminiCliProvider — snapshot probe for the Gemini CLI provider.
 *
 * Mirrors `ClaudeProvider` / `OpenCodeProvider`: exposes
 * `checkGeminiCliStatus(config, env)` which spawns `gemini --version` and
 * returns a `ServerProviderDraft`, plus `makePendingGeminiCliProvider(config)`
 * which returns the placeholder shape used before the first probe completes.
 *
 * Drivers stamp `instanceId` / `driver` / `displayName` onto the draft via
 * `withInstanceIdentity` in `GeminiCliDriver`.
 *
 * @module provider/Layers/GeminiCliProvider
 */
import {
  type GeminiCliSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { createModelCapabilities } from "@t3tools/shared/model";

import {
  buildServerProvider as buildServerProviderBase,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { GEMINI_CLI_SLASH_COMMANDS } from "../providerSlashCommandPresets.ts";

/**
 * Local wrapper that stamps the Gemini/Antigravity slash-command preset onto
 * every snapshot this module builds. Gemini's CLI does not report its command
 * list over the wire, so we inject the static catalog here for the composer
 * command menu.
 */
const buildServerProvider = (
  input: Omit<Parameters<typeof buildServerProviderBase>[0], "slashCommands">,
): ServerProviderDraft =>
  buildServerProviderBase({ ...input, slashCommands: GEMINI_CLI_SLASH_COMMANDS });

const PROVIDER = ProviderDriverKind.make("geminiCli");
const GEMINI_PRESENTATION = {
  displayName: "Gemini CLI",
  showInteractionModeToggle: true,
} as const;
const ANTIGRAVITY_PRESENTATION = {
  displayName: "Antigravity (Gemini)",
  showInteractionModeToggle: true,
} as const;

/**
 * Capabilities for known Gemini models.
 *
 * A `thinkingBudget` selector used to live here, but it was inert: the chosen
 * value was never read by the adapter and never reached the Gemini CLI (which
 * exposes no per-invocation thinking flag), so it rendered a control that did
 * nothing. It has been removed rather than ship a misleading trait. Reinstate
 * it only together with real wiring (e.g. a per-turn settings.json
 * `thinkingConfig` override) verified against an actual Gemini CLI.
 */
const DEFAULT_GEMINI_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3-flash",
    name: "Gemini 3 Flash",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
];

// Antigravity models. The `slug` is passed verbatim to `agy --model`, which
// resolves models by their display label (verified against the CLI: `agy models`
// lists these, and the CLI logs `Propagating selected model override ...
// label="Gemini 3.1 Pro (High)"`). `auto` is special-cased in
// buildAntigravityArgs to omit `--model` and use the CLI's default.
const ANTIGRAVITY_MODEL_LABELS = [
  "Gemini 3.5 Flash (Low)",
  "Gemini 3.5 Flash (Medium)",
  "Gemini 3.5 Flash (High)",
  "Gemini 3.1 Pro (Low)",
  "Gemini 3.1 Pro (High)",
  "Claude Sonnet 4.6 (Thinking)",
  "Claude Opus 4.6 (Thinking)",
  "GPT-OSS 120B (Medium)",
] as const;

const ANTIGRAVITY_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "auto",
    name: "Antigravity (Automatic)",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  ...ANTIGRAVITY_MODEL_LABELS.map(
    (label): ServerProviderModel => ({
      slug: label,
      name: label,
      isCustom: false,
      capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
    }),
  ),
];

function presentationFor(config: GeminiCliSettings) {
  return config.antigravity ? ANTIGRAVITY_PRESENTATION : GEMINI_PRESENTATION;
}

function builtInModelsFor(config: GeminiCliSettings): ReadonlyArray<ServerProviderModel> {
  return config.antigravity ? ANTIGRAVITY_BUILT_IN_MODELS : BUILT_IN_MODELS;
}

function cliLabel(config: GeminiCliSettings): string {
  return config.antigravity ? "Antigravity CLI" : "Gemini CLI";
}

/** Resolve the configured binary path, or fall back to `"gemini"`. */
function resolveBinary(config: GeminiCliSettings): string {
  const trimmed = config.binaryPath.trim();
  return trimmed.length > 0 ? trimmed : config.antigravity ? "agy" : "gemini";
}

const runGeminiCommand = Effect.fn("runGeminiCommand")(function* (
  config: GeminiCliSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const binaryPath = resolveBinary(config);
  const command = ChildProcess.make(binaryPath, [...args], {
    env: environment,
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Provider snapshot probes are pure process spawns outside the Effect runtime service graph.
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(binaryPath, command);
});

export const checkGeminiCliStatus = Effect.fn("checkGeminiCliStatus")(function* (
  config: GeminiCliSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const checkedAt = new Date().toISOString();
  const allModels = providerModelsFromSettings(
    builtInModelsFor(config),
    PROVIDER,
    config.customModels,
    DEFAULT_GEMINI_MODEL_CAPABILITIES,
  );

  if (!config.enabled) {
    return buildServerProvider({
      presentation: presentationFor(config),
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: `${cliLabel(config)} is disabled in T3 Code settings.`,
      },
    });
  }

  const versionProbe = yield* runGeminiCommand(config, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: presentationFor(config),
      enabled: config.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? `${cliLabel(config)} (${config.antigravity ? "`agy`" : "`gemini`"}) is not installed or not on PATH.`
          : `Failed to execute ${cliLabel(config)} health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: presentationFor(config),
      enabled: config.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: `${cliLabel(config)} is installed but failed to run. Timed out while running command.`,
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: presentationFor(config),
      enabled: config.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `${cliLabel(config)} is installed but failed to run. ${detail}`
          : `${cliLabel(config)} is installed but failed to run.`,
      },
    });
  }

  return buildServerProvider({
    presentation: presentationFor(config),
    enabled: config.enabled,
    checkedAt,
    models: allModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: {
        status: "authenticated",
        type: "geminiCli",
        label: cliLabel(config),
      },
    },
  });
});

export const makePendingGeminiCliProvider = (config: GeminiCliSettings): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    builtInModelsFor(config),
    PROVIDER,
    config.customModels,
    DEFAULT_GEMINI_MODEL_CAPABILITIES,
  );

  if (!config.enabled) {
    return buildServerProvider({
      presentation: presentationFor(config),
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: `${cliLabel(config)} is disabled in T3 Code settings.`,
      },
    });
  }

  return buildServerProvider({
    presentation: presentationFor(config),
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: `${cliLabel(config)} provider status has not been checked in this session yet.`,
    },
  });
};

export {
  ANTIGRAVITY_BUILT_IN_MODELS,
  BUILT_IN_MODELS as GEMINI_BUILT_IN_MODELS,
  DEFAULT_GEMINI_MODEL_CAPABILITIES,
};
