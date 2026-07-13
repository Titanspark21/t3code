// FILE: providerSlashCommandActions.ts
// Purpose: Client-side behavior for provider slash commands that should not be
// sent verbatim to the agent. `/usage` (Claude/Gemini) and `/status` (Codex)
// open a non-blocking usage popup instead of consuming a turn; a few Codex
// commands expand to a concrete instruction because Codex's app-server transport
// does not interpret TUI slash text.

import type { ProviderDriverKind } from "@t3tools/contracts";

export type ProviderSlashCommandAction =
  | { readonly kind: "usage" }
  | { readonly kind: "prompt"; readonly text: string };

const CODEX_PROMPT_EXPANSIONS: Readonly<Record<string, string>> = {
  init: "Create an AGENTS.md file documenting this codebase's structure, key modules, conventions, and how to build, run, and test it.",
  review:
    "Review the current working-tree changes and point out bugs, regressions, security issues, and concrete improvements.",
  diff: "Summarize the current git working-tree changes (staged and unstaged) file by file.",
};

function isCodex(provider: ProviderDriverKind): boolean {
  return provider === "codex";
}

/**
 * Resolve the client-side action for a provider slash command, or `null` when
 * the command should follow the default behavior (insert `/name ` into the
 * composer to be sent as the turn text).
 */
export function resolveProviderSlashCommandAction(
  provider: ProviderDriverKind,
  commandName: string,
): ProviderSlashCommandAction | null {
  const name = commandName.trim().toLowerCase();

  if (name === "usage") {
    return { kind: "usage" };
  }
  if (name === "status" && isCodex(provider)) {
    return { kind: "usage" };
  }

  if (isCodex(provider)) {
    const expansion = CODEX_PROMPT_EXPANSIONS[name];
    if (expansion) {
      return { kind: "prompt", text: expansion };
    }
  }

  return null;
}

/**
 * When the composer holds only a standalone usage command (e.g. the user typed
 * `/usage` and pressed Enter), return the usage action so the send path can open
 * the popup instead of dispatching a turn.
 */
export function parseStandaloneUsageCommand(text: string, provider: ProviderDriverKind): boolean {
  const match = /^\/(\w+)\s*$/.exec(text.trim());
  if (!match) return false;
  const action = resolveProviderSlashCommandAction(provider, match[1] ?? "");
  return action?.kind === "usage";
}
