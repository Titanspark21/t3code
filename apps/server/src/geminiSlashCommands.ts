/**
 * Antigravity / Gemini CLI slash commands surfaced in the T3 composer.
 *
 * The Gemini CLI (and its Antigravity `agy` variant) expose slash commands that
 * only exist inside their interactive REPL. T3 drives the CLI in one-shot
 * `--print` mode, so those commands never reach the user. This module gives the
 * composer a curated, meaningful set and lets the manager execute the ones T3
 * can run itself:
 *
 *  - **Native** commands (`/help`, `/clear`, `/stats`) are handled entirely by
 *    the manager — no CLI round-trip — so they always work regardless of what
 *    the installed CLI supports in print mode.
 *  - The remaining commands are passed to the CLI verbatim (`agy --print
 *    "/tools"`), a best-effort hand-off for CLIs that honor them non-
 *    interactively; if the CLI ignores them the model simply answers the text.
 *
 * @module geminiSlashCommands
 */
import type { ServerProviderSlashCommand } from "@t3tools/contracts";

export interface GeminiSlashCommandSpec {
  /** Command name without the leading slash. */
  readonly name: string;
  readonly description: string;
  /** True when the manager executes the command itself (see module docs). */
  readonly native: boolean;
}

export const GEMINI_SLASH_COMMAND_SPECS: ReadonlyArray<GeminiSlashCommandSpec> = [
  {
    name: "help",
    description: "List the available Antigravity / Gemini slash commands",
    native: true,
  },
  {
    name: "clear",
    description: "Start fresh — clear this thread's conversation history and context",
    native: true,
  },
  {
    name: "stats",
    description: "Show token usage for this Antigravity / Gemini session",
    native: true,
  },
  {
    name: "compress",
    description: "Ask the model to compress the conversation so far into a summary",
    native: false,
  },
  { name: "memory", description: "Show or refresh the project GEMINI.md memory", native: false },
  { name: "tools", description: "List the tools available to the agent", native: false },
  { name: "mcp", description: "List configured MCP servers", native: false },
];

/** Snapshot shape consumed by the provider status / composer command menu. */
export const GEMINI_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> =
  GEMINI_SLASH_COMMAND_SPECS.map(({ name, description }) => ({ name, description }));

const NATIVE_COMMAND_NAMES: ReadonlySet<string> = new Set(
  GEMINI_SLASH_COMMAND_SPECS.filter((spec) => spec.native).map((spec) => spec.name),
);

export interface ParsedSlashCommand {
  /** Lower-cased command name without the leading slash. */
  readonly name: string;
  /** Any text following the command name, trimmed. */
  readonly args: string;
}

/**
 * Parse a leading `/command args` out of a composer message. Returns `null`
 * when the text is not a slash command (so normal prompts are untouched).
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const match = trimmed.slice(1).match(/^([a-zA-Z][\w-]*)([\s\S]*)$/);
  const name = match?.[1];
  if (!name) return null;
  return { name: name.toLowerCase(), args: (match?.[2] ?? "").trim() };
}

export function isNativeGeminiSlashCommand(name: string): boolean {
  return NATIVE_COMMAND_NAMES.has(name.toLowerCase());
}

export interface GeminiSessionStats {
  readonly messageCount: number;
  readonly turnCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString("en-US") : "0";
}

/** Markdown help text listing every surfaced command. */
export function renderHelpResponse(): string {
  const lines = GEMINI_SLASH_COMMAND_SPECS.map(
    (spec) => `- \`/${spec.name}\` — ${spec.description}`,
  );
  return ["**Antigravity / Gemini commands**", "", ...lines].join("\n");
}

export function renderClearResponse(): string {
  return "Conversation history cleared. The next message starts a fresh context.";
}

export function renderStatsResponse(stats: GeminiSessionStats): string {
  return [
    "**Session usage**",
    "",
    `- Messages in context: ${formatCount(stats.messageCount)}`,
    `- Completed turns: ${formatCount(stats.turnCount)}`,
    `- Input tokens: ${formatCount(stats.inputTokens)}`,
    `- Output tokens: ${formatCount(stats.outputTokens)}`,
    `- Total tokens: ${formatCount(stats.totalTokens)}`,
  ].join("\n");
}

/** Resolve the native response text for a parsed command; `null` when unknown. */
export function renderNativeSlashCommandResponse(
  command: ParsedSlashCommand,
  stats: GeminiSessionStats,
): string | null {
  switch (command.name) {
    case "help":
      return renderHelpResponse();
    case "clear":
      return renderClearResponse();
    case "stats":
      return renderStatsResponse(stats);
    default:
      return null;
  }
}
