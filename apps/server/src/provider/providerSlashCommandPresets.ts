// FILE: providerSlashCommandPresets.ts
// Purpose: Static slash-command catalogs for providers whose CLIs do not report
// their command list over the wire (Gemini CLI / Antigravity and Codex).
//
// Claude surfaces its commands through the Agent SDK initialization result
// (see ClaudeProvider.parseClaudeInitializationCommands). Gemini and Codex have
// no such probe, so their `/` menu was empty even though the commands work. We
// declare curated presets here and hand them to `buildServerProvider` so the
// composer command menu can list them.
//
// Execution:
//  - Gemini/Antigravity commands are handled by the CLI itself when the text is
//    sent as a turn (verified: `/help`, `/stats`, etc. return output).
//  - The account-usage commands (`/usage`, `/status`) are intercepted by the web
//    client and open a non-blocking usage popup instead of being sent as a turn
//    (see apps/web/src/lib/usageSlashCommands.ts). Codex's app-server transport
//    does not interpret TUI slash commands, so `/status` MUST be intercepted for
//    it to work at all.

import type { ServerProviderSlashCommand } from "@t3tools/contracts";

/**
 * Antigravity (`agy`) and Gemini CLI (`gemini`) share the same interactive
 * slash-command surface. `/usage` is intercepted client-side; the rest are
 * passed through to the CLI as the turn text.
 */
export const GEMINI_CLI_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> = [
  { name: "usage", description: "Show account usage & rate limits" },
  { name: "help", description: "List the available slash commands" },
  { name: "stats", description: "Show session token usage and stats" },
  { name: "compress", description: "Compress (summarize) the conversation context" },
  { name: "memory", description: "Show the loaded memory / GEMINI.md context" },
  { name: "tools", description: "List the tools available to the agent" },
  { name: "mcp", description: "List configured MCP servers and their tools" },
  { name: "clear", description: "Clear the conversation history" },
];

/**
 * Codex slash commands. Codex talks to T3 over the app-server JSON-RPC transport
 * which does not interpret TUI slash text, so the meaningful commands are either
 * intercepted client-side (`/status`, `/usage`, `/model`) or expressed as a
 * concrete instruction sent to the agent (`/init`, `/review`, `/diff`).
 */
export const CODEX_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> = [
  { name: "status", description: "Show account usage & rate limits" },
  { name: "usage", description: "Show account usage & rate limits" },
  { name: "init", description: "Generate an AGENTS.md for this repository" },
  { name: "review", description: "Review the current changes for bugs and issues" },
  { name: "diff", description: "Summarize the current git working-tree changes" },
];
