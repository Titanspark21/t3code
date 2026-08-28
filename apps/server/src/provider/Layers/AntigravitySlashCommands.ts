/**
 * Verified Antigravity CLI slash-command metadata.
 *
 * Antigravity's ACP bridge may expose commands at runtime, but not every
 * bridge forwards that optional notification. Keep this small catalogue to
 * commands verified in the provider's own documentation and never infer the
 * rest of the TUI menu. The provider snapshot still gates each entry against
 * the installed CLI version.
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

/** Verified from Antigravity CLI documentation and the fork's 1.1.5 probe notes. */
const ANTIGRAVITY_SLASH_COMMAND_METADATA: ReadonlyArray<AntigravitySlashCommandMetadata> = [
  {
    name: "help",
    syntax: "/help",
    description: "Open Antigravity's help, command, and shortcut tabs.",
    sideEffects: "Read-only.",
    minimumVersion: "1.1.7",
  },
  {
    name: "config",
    syntax: "/config",
    description: "Open Antigravity configuration.",
    sideEffects: "Changes settings only if you make a selection in the panel.",
    minimumVersion: "1.1.7",
  },
  {
    name: "settings",
    syntax: "/settings",
    description: "Open Antigravity settings.",
    sideEffects: "Changes settings only if you make a selection in the panel.",
    minimumVersion: "1.1.7",
  },
  {
    name: "model",
    syntax: "/model",
    description: "Choose the model for this Antigravity session.",
    sideEffects: "Changes the model for subsequent turns.",
    minimumVersion: "1.1.7",
  },
  {
    name: "planning",
    syntax: "/planning",
    description: "Enable Antigravity planning mode.",
    sideEffects: "Changes the agent to planning behavior.",
    minimumVersion: "1.1.7",
  },
  {
    name: "mcp",
    syntax: "/mcp",
    description: "Inspect configured MCP servers and tools.",
    sideEffects: "Read-only until you choose a management action.",
    minimumVersion: "1.1.7",
  },
  {
    name: "quit",
    syntax: "/quit",
    description: "Exit Antigravity CLI.",
    sideEffects: "Ends the provider session; the conversation remains resumable.",
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
