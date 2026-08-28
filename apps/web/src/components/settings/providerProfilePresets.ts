import type { ProviderDriverKind } from "@t3tools/contracts";

export interface ProviderProfilePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly displayName: string;
  readonly config: Readonly<Record<string, unknown>>;
}

const ANTIGRAVITY_PRESETS: ReadonlyArray<ProviderProfilePreset> = [
  {
    id: "antigravity-1",
    label: "AGY-1",
    description: "Uses ~/.gemini-1 as the isolated Antigravity profile",
    displayName: "AGY-1",
    config: { binaryPath: "agy", profileDir: "~/.gemini-1" },
  },
  {
    id: "antigravity-2",
    label: "AGY-2",
    description: "Uses ~/.gemini-2 as the isolated Antigravity profile",
    displayName: "AGY-2",
    config: { binaryPath: "agy", profileDir: "~/.gemini-2" },
  },
  {
    id: "antigravity-3",
    label: "AGY-3",
    description: "Uses ~/.gemini-3 as the isolated Antigravity profile",
    displayName: "AGY-3",
    config: { binaryPath: "agy", profileDir: "~/.gemini-3" },
  },
  {
    id: "antigravity-4",
    label: "AGY-4",
    description: "Uses ~/.gemini-4 as the isolated Antigravity profile",
    displayName: "AGY-4",
    config: { binaryPath: "agy", profileDir: "~/.gemini-4" },
  },
  {
    id: "antigravity-5",
    label: "AGY-5",
    description: "Uses ~/.gemini-5 as the isolated Antigravity profile",
    displayName: "AGY-5",
    config: { binaryPath: "agy", profileDir: "~/.gemini-5" },
  },
];

export function getProviderProfilePresets(
  driver: ProviderDriverKind,
): ReadonlyArray<ProviderProfilePreset> {
  return driver === "antigravity" ? ANTIGRAVITY_PRESETS : [];
}
