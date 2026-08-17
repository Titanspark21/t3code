/**
 * Antigravity (`agy`) provider settings.
 *
 * Fork-local (OmniCode). Lives in its own file rather than in `settings.ts`
 * because the driver-agnostic `providerInstances` map treats each driver's
 * config as opaque (`Schema.Unknown` at the contracts layer), precisely so a
 * fork can add a driver without touching the shared struct. See
 * `providerInstance.ts` for that forward-compatibility invariant, and `OMNI.md`
 * for why we care.
 *
 * ## Why there is a bridge command
 *
 * `agy` has no native ACP mode. There is an open upstream request for an
 * `--acp` flag (google-antigravity/antigravity-cli#31), and several community
 * adapters wrap the CLI in the meantime. Rather than reimplement a private
 * protocol, this driver speaks ACP to a bridge process and lets the bridge
 * command be configured. If Google ships `--acp`, the only change is the
 * default: point `bridgeCommand` at `agy` itself with `--acp` in
 * `bridgeArgs`, and everything downstream keeps working.
 *
 * @module antigravity
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedString } from "./baseSchemas.ts";
import { makeProviderSettingsSchema } from "./settings.ts";

/**
 * Default ACP bridge. Deliberately empty: an unconfigured instance must report
 * "no bridge configured" with instructions, not silently launch some package
 * off the network. The provider status check turns this into an actionable
 * error rather than a mysterious spawn failure.
 */
export const DEFAULT_ANTIGRAVITY_BRIDGE_COMMAND = "";

export const AntigravitySettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("agy")),
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Antigravity CLI. Used for health and model checks.",
        providerSettingsForm: { placeholder: "agy", clearWhenEmpty: "omit" },
      }),
    ),
    profileDir: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Account profile directory",
        description:
          "Isolated home for this Antigravity login. agy keys its identity off the home directory, so each account needs its own. Git, SSH and npm keep using your real profile.",
        providerSettingsForm: { placeholder: "~/.gemini-1", clearWhenEmpty: "omit" },
      }),
    ),
    bridgeCommand: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_ANTIGRAVITY_BRIDGE_COMMAND)),
      Schema.annotateKey({
        title: "ACP bridge command",
        description:
          "Executable that speaks Agent Client Protocol over stdio and drives agy. Required until the Antigravity CLI ships a native --acp mode.",
        providerSettingsForm: { placeholder: "npx", clearWhenEmpty: "omit" },
      }),
    ),
    bridgeArgs: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({
        title: "ACP bridge arguments",
        description: "Arguments passed to the bridge command, one per entry.",
        providerSettingsForm: { hidden: true },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "profileDir", "bridgeCommand"],
  },
);
export type AntigravitySettings = typeof AntigravitySettings.Type;
