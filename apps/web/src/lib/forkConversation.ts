// FILE: forkConversation.ts
// Purpose: Serialize a thread's message history into a transcript and wrap it in
// a hand-off prompt so a forked thread's new provider can continue seamlessly.

import type { OrchestrationMessage } from "@t3tools/contracts";

// Keep the seeded context well under typical model context windows. Forking a
// very long thread trims the oldest turns rather than overflowing the target.
const MAX_TRANSCRIPT_CHARS = 48_000;

function roleLabel(role: OrchestrationMessage["role"]): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    default:
      return "System";
  }
}

/**
 * Render user/assistant messages as a readable markdown transcript. System
 * messages and empty/streaming placeholders are skipped. When the transcript
 * exceeds the size cap, the oldest messages are dropped and a marker is
 * prepended so the model knows history was truncated.
 */
export function serializeThreadTranscript(messages: ReadonlyArray<OrchestrationMessage>): string {
  const blocks: string[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const text = message.text.trim();
    if (!text) continue;
    blocks.push(`**${roleLabel(message.role)}:**\n${text}`);
  }

  let transcript = blocks.join("\n\n");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    let truncated = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS);
    const firstBreak = truncated.indexOf("\n\n**");
    if (firstBreak > 0) {
      truncated = truncated.slice(firstBreak + 2);
    }
    transcript = `_[earlier messages truncated]_\n\n${truncated}`;
  }
  return transcript;
}

/**
 * Build the seed prompt for the forked thread: an instruction plus the prior
 * transcript, so the new provider has full context and continues rather than
 * restarting.
 */
export function buildForkContextPrompt(input: {
  transcript: string;
  sourceTitle: string | null;
  sourceProviderDisplayName: string | null;
}): string {
  const origin = input.sourceTitle ? ` titled "${input.sourceTitle}"` : "";
  const from = input.sourceProviderDisplayName
    ? ` (originally handled by ${input.sourceProviderDisplayName})`
    : "";
  return [
    `This conversation was forked from an earlier thread${origin}${from}. The full prior transcript is included below as context.`,
    "",
    "Read it, then continue the work from where it left off. Do not restart, re-introduce yourself, or repeat prior steps that were already completed.",
    "",
    "--- BEGIN FORKED CONVERSATION ---",
    input.transcript,
    "--- END FORKED CONVERSATION ---",
  ].join("\n");
}
