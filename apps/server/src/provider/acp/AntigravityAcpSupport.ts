/**
 * Provider-specific ACP surface for Antigravity (`agy`).
 *
 * Mirrors `GrokAcpSupport.ts`: everything protocol-level lives in
 * `AcpSessionRuntime`, and this file supplies only the parts that are specific
 * to this agent — how to spawn it, which auth method to name, and how model
 * selection maps.
 *
 * `agy` has no native ACP mode yet, so T3 ships a small stream-JSON bridge. A
 * user-configured bridge is still supported for installations that need one,
 * but blank bridge settings use the built-in bridge automatically.
 *
 * @module provider/acp/AntigravityAcpSupport
 */
import type { AntigravitySettings } from "@t3tools/contracts/antigravity";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { makeAntigravityEnvironment } from "../Drivers/AntigravityHome.ts";
import { stripPermissionBypassFlags } from "../Drivers/AntigravityLaunch.ts";

/**
 * Most community ACP bridges do not implement a distinct auth step — the
 * underlying `agy` login is already on disk in the profile directory — so the
 * cached-token method is the right default.
 */
const ANTIGRAVITY_AUTH_METHOD_CACHED_TOKEN = "cached_token";

/**
 * Points the bridge at the CLI this instance is configured to use, so the
 * bridge does not independently resolve `agy` from `PATH` and land on a
 * different binary than the one the health probe checked.
 */
const ANTIGRAVITY_BINARY_ENV = "AGY_BINARY";

export type AntigravityAcpSettings = Pick<
  AntigravitySettings,
  "binaryPath" | "bridgeCommand" | "bridgeArgs" | "profileDir"
>;

export interface AntigravityAcpSpawnResult {
  readonly spawn: AcpSessionRuntime.AcpSpawnInput;
  /**
   * Bypass flags removed from the user's bridge arguments. Non-empty means the
   * user asked for something that was refused, and the UI should say so rather
   * than quietly disagreeing.
   */
  readonly removedFlags: ReadonlyArray<string>;
}

export class AntigravityBridgeNotConfiguredError extends Error {
  readonly _tag = "AntigravityBridgeNotConfiguredError";
  constructor() {
    super("The built-in Antigravity ACP bridge could not locate the T3 CLI entrypoint.");
  }
}

/**
 * Build the bridge spawn input.
 *
 * Two guarantees, both because these arguments come from a settings text box:
 *
 *  - permission-bypass flags are stripped, so the guardrail in
 *    `AntigravityLaunch.antigravityModeFlags` cannot be undone by pasting
 *    `--dangerously-skip-permissions` into the bridge arguments;
 *  - the process runs under this instance's isolated environment, so the bridge
 *    and the `agy` it spawns resolve the same account.
 */
export function buildAntigravityAcpSpawnInput(
  settings: AntigravityAcpSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AntigravityAcpSpawnResult {
  const configuredCommand = settings.bridgeCommand.trim();
  const entrypoint = process.argv[1]?.trim();
  const command = configuredCommand || process.execPath;
  const configuredArgs = stripPermissionBypassFlags(settings.bridgeArgs);
  const args = configuredCommand
    ? configuredArgs.args
    : entrypoint
      ? [entrypoint, "antigravity-acp-bridge"]
      : (() => {
          throw new AntigravityBridgeNotConfiguredError();
        })();
  const removed = configuredCommand ? configuredArgs.removed : [];
  const isolated = makeAntigravityEnvironment(settings, environment ?? process.env);

  return {
    spawn: {
      command,
      args,
      cwd,
      env: {
        ...isolated,
        [ANTIGRAVITY_BINARY_ENV]: settings.binaryPath.trim() || "agy",
      },
    },
    removedFlags: removed,
  };
}

interface AntigravityAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly settings: AntigravityAcpSettings;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makeAntigravityAcpRuntime = (
  input: AntigravityAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const { spawn } = buildAntigravityAcpSpawnInput(input.settings, input.cwd, input.environment);
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn,
        authMethodId: ANTIGRAVITY_AUTH_METHOD_CACHED_TOKEN,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

/**
 * Model the session should use.
 *
 * Antigravity bakes the reasoning tier into the model id (`gemini-3.5-flash-high`),
 * so there is no separate effort axis to reconcile — the requested slug is the
 * whole selection. Deliberately not normalized through `normalizeModelSlug`:
 * the CLI resolves models by the exact id `agy models` printed, and rewriting
 * it risks producing one the CLI will not accept.
 */
export function resolveAntigravityAcpModelId(model: string | null | undefined): string | undefined {
  return model?.trim() || undefined;
}

export function currentAntigravityModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

/**
 * Switch models only when the request differs from what the session already
 * has, so an unchanged selection costs no round trip.
 */
export function applyAntigravityAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  if (input.requestedModelId === undefined || input.requestedModelId === input.currentModelId) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}
