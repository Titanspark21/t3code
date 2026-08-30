/**
 * Verified Antigravity CLI slash-command metadata.
 *
 * Antigravity's ACP bridge may expose commands at runtime, but the stream-JSON
 * protocol does not forward slash commands to the long-lived process. These
 * are the commands the CLI advertises from `agy -p /help`; the built-in bridge
 * executes them as one-shot CLI reports instead of sending them into the
 * stream. The provider snapshot still gates each entry against the installed
 * CLI version.
 *
 * @module provider/Layers/AntigravitySlashCommands
 */
import type { ServerProviderSlashCommand } from "@t3tools/contracts";
import { compareSemverVersions } from "@t3tools/shared/semver";

interface AntigravitySlashCommandMetadata {
  readonly name: string;
  readonly syntax: string;
  readonly description: string;
  readonly sideEffects: string;
  readonly minimumVersion: string;
}

/** Verified against the current `agy -p /help` output (CLI 1.1.22). */
const ANTIGRAVITY_SLASH_COMMAND_METADATA: ReadonlyArray<AntigravitySlashCommandMetadata> = [
  {
    name: "agents",
    syntax: "/agents",
    description: "List available custom agents.",
    sideEffects: "Read-only.",
    minimumVersion: "1.1.7",
  },
  {
    name: "changelog",
    syntax: "/changelog",
    description: "Show Antigravity release notes and changes.",
    sideEffects: "Read-only.",
    minimumVersion: "1.1.7",
  },
  {
    name: "config",
    syntax: "/config (settings)",
    description: "Open Antigravity's settings panel.",
    sideEffects: "Changes settings only if you make a selection in the panel.",
    minimumVersion: "1.1.7",
  },
  {
    name: "credits",
    syntax: "/credits",
    description: "Show remaining G1 credits and purchase links.",
    sideEffects: "Read-only.",
    minimumVersion: "1.1.7",
  },
  {
    name: "effort",
    syntax: "/effort",
    description: "Set the reasoning effort for subsequent turns.",
    sideEffects: "Changes the reasoning effort for the session.",
    minimumVersion: "1.1.7",
  },
  {
    name: "exit",
    syntax: "/exit (quit)",
    description: "Exit the Antigravity CLI session.",
    sideEffects: "Ends the provider session; the conversation remains resumable.",
    minimumVersion: "1.1.7",
  },
  {
    name: "help",
    syntax: "/help",
    description: "Show available commands and keybindings.",
    sideEffects: "Read-only.",
    minimumVersion: "1.1.7",
  },
  {
    name: "hooks",
    syntax: "/hooks",
    description: "Manage hook configurations for tool events.",
    sideEffects: "Changes hooks only if you make a selection in the panel.",
    minimumVersion: "1.1.7",
  },
  {
    name: "model",
    syntax: "/model",
    description: "Choose the model for subsequent turns.",
    sideEffects: "Changes the model selection for the session.",
    minimumVersion: "1.1.7",
  },
  {
    name: "permissions",
    syntax: "/permissions",
    description: "Manage tool permissions.",
    sideEffects: "Changes permissions only if you make a selection in the panel.",
    minimumVersion: "1.1.7",
  },
  {
    name: "skills",
    syntax: "/skills",
    description: "List available skills.",
    sideEffects: "Read-only.",
    minimumVersion: "1.1.7",
  },
  {
    name: "usage",
    syntax: "/usage (quota)",
    description: "View model quota usage.",
    sideEffects: "Read-only.",
    minimumVersion: "1.1.7",
  },
];

function normalizeVersion(value: string | null): string | null {
  if (!value) return null;
  const match = /(?:^|\D)(\d+\.\d+\.\d+)(?:\D|$)/u.exec(value);
  return match?.[1] ?? null;
}

/**
 * Build the provider-owned commands without inventing commands absent from
 * the verified catalogue. An unreadable version leaves entries visible but
 * explicitly unverified, matching the command-menu contract.
 */
export function enrichAntigravitySlashCommands(
  installedVersion: string | null,
): ReadonlyArray<ServerProviderSlashCommand> {
  const normalizedVersion = normalizeVersion(installedVersion);

  return ANTIGRAVITY_SLASH_COMMAND_METADATA.map((metadata) => {
    const support =
      normalizedVersion === null
        ? "unknown"
        : compareSemverVersions(normalizedVersion, metadata.minimumVersion) >= 0
          ? "supported"
          : "unsupported";
    const supportNote =
      support === "unknown"
        ? "Antigravity CLI version could not be read; command support is unverified."
        : support === "unsupported"
          ? `Requires Antigravity CLI ${metadata.minimumVersion} or newer; installed version is ${normalizedVersion}.`
          : `Supported by the installed Antigravity CLI; verified since ${metadata.minimumVersion}.`;

    return {
      name: metadata.name,
      syntax: metadata.syntax,
      description: metadata.description,
      sideEffects: metadata.sideEffects,
      duringWork: "idle-only",
      output: "conversation",
      minimumVersion: metadata.minimumVersion,
      support,
      supportNote,
    } satisfies ServerProviderSlashCommand;
  });
}
