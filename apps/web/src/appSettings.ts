/**
 * appSettings — fork-local app settings shim.
 *
 * The fork historically extended ServerSettings with many client-side
 * preferences (custom model lists per provider, theme controls, etc.).
 * Upstream's PR #2277 reshuffled the contracts package enough that the
 * old fork-flavored AppSettings no longer compiles. This shim exposes a
 * minimal AppSettings type covering the fields that surviving consumers
 * still read, backed by `useSettings` for the parts that are now
 * server-authoritative.
 *
 * TODO(sync): rebuild the rich custom-model + theme controls UI on top
 * of the new ProviderInstance settings model.
 */
import { useMemo } from "react";

import { useSettings } from "./hooks/useSettings";

export type AppProviderLogoAppearance = "color" | "grayscale";

export interface AppSettings {
  // ── Mirrored from server settings ──
  readonly diffWordWrap: boolean;
  readonly timestampFormat: "locale" | "12-hour" | "24-hour";
  // ── Theme controls (local-only, defaults retained) ──
  readonly accentColor: string;
  readonly providerLogoAppearance: AppProviderLogoAppearance;
  readonly grayscaleProviderLogos: boolean;
  readonly uiFont: string;
  readonly codeFont: string;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly backgroundColorOverride: string;
  readonly foregroundColorOverride: string;
  readonly contrast: number;
  readonly translucency: boolean;
  // ── Misc UI behaviors ──
  readonly showCommandOutput: boolean;
  readonly showFileChangeDiffs: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  diffWordWrap: false,
  timestampFormat: "locale",
  accentColor: "",
  providerLogoAppearance: "color",
  grayscaleProviderLogos: false,
  uiFont: "",
  codeFont: "",
  uiFontSize: 0,
  codeFontSize: 0,
  backgroundColorOverride: "",
  foregroundColorOverride: "",
  contrast: 0,
  translucency: false,
  showCommandOutput: true,
  showFileChangeDiffs: true,
};

let cachedSnapshot: AppSettings = DEFAULT_APP_SETTINGS;

export function getAppSettingsSnapshot(): AppSettings {
  return cachedSnapshot;
}

export function useAppSettings(): { settings: AppSettings } {
  const serverSettings = useSettings();

  const settings = useMemo<AppSettings>(() => {
    const next: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      diffWordWrap:
        (serverSettings as { diffWordWrap?: boolean } | undefined)?.diffWordWrap ??
        DEFAULT_APP_SETTINGS.diffWordWrap,
      timestampFormat:
        (serverSettings as { timestampFormat?: AppSettings["timestampFormat"] } | undefined)
          ?.timestampFormat ?? DEFAULT_APP_SETTINGS.timestampFormat,
    };
    cachedSnapshot = next;
    return next;
  }, [serverSettings]);

  return { settings };
}
