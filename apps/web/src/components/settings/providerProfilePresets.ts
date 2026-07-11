import { type ProviderDriverKind } from "@t3tools/contracts";

export interface ProviderProfilePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly displayName: string;
  readonly config: Readonly<Record<string, unknown>>;
}

const CLAUDE_PRESETS: ReadonlyArray<ProviderProfilePreset> = [
  {
    id: "claude-1",
    label: "Claude 1",
    description: "Uses ~/.claude-1 via CLAUDE_CONFIG_DIR",
    displayName: "Claude 1",
    config: { configDir: "~/.claude-1" },
  },
  {
    id: "claude-2",
    label: "Claude 2",
    description: "Uses ~/.claude-2 via CLAUDE_CONFIG_DIR",
    displayName: "Claude 2",
    config: { configDir: "~/.claude-2" },
  },
];

const ANTIGRAVITY_PRESETS: ReadonlyArray<ProviderProfilePreset> = [
  {
    id: "agy-1",
    label: "Antigravity 1",
    description: "Uses ~/.gemini-1 with the agy CLI",
    displayName: "Antigravity 1",
    config: {
      antigravity: true,
      binaryPath: "agy",
      configDir: "~/.gemini-1",
    },
  },
  {
    id: "agy-2",
    label: "Antigravity 2",
    description: "Uses ~/.gemini-2 with the agy CLI",
    displayName: "Antigravity 2",
    config: {
      antigravity: true,
      binaryPath: "agy",
      configDir: "~/.gemini-2",
    },
  },
];

export function getProviderProfilePresets(
  driver: ProviderDriverKind,
): ReadonlyArray<ProviderProfilePreset> {
  if (driver === "claudeAgent") return CLAUDE_PRESETS;
  if (driver === "geminiCli") return ANTIGRAVITY_PRESETS;
  return [];
}
