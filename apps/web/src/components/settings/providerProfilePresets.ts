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
    label: "Antigravity 1",
    description: "Uses ~/.gemini-1 as the isolated Antigravity profile",
    displayName: "Antigravity 1",
    config: { binaryPath: "agy", profileDir: "~/.gemini-1" },
  },
  {
    id: "antigravity-2",
    label: "Antigravity 2",
    description: "Uses ~/.gemini-2 as the isolated Antigravity profile",
    displayName: "Antigravity 2",
    config: { binaryPath: "agy", profileDir: "~/.gemini-2" },
  },
  {
    id: "antigravity-3",
    label: "Antigravity 3",
    description: "Uses ~/.gemini-3 as the isolated Antigravity profile",
    displayName: "Antigravity 3",
    config: { binaryPath: "agy", profileDir: "~/.gemini-3" },
  },
];

export function getProviderProfilePresets(
  driver: ProviderDriverKind,
): ReadonlyArray<ProviderProfilePreset> {
  return driver === "antigravity" ? ANTIGRAVITY_PRESETS : [];
}
