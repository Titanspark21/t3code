/**
 * Helpers for forking a chat into a new thread with a different provider/model.
 *
 * A live CLI session can't be handed between providers, so a cross-provider fork
 * replays the prior conversation to the new provider as context on the fork's
 * first turn (full transcript replay). These pure helpers build that seed prompt
 * and the fork's title; the dispatch itself lives in ChatView.
 *
 * @module forkThread
 */
import type { OrchestrationMessage } from "@t3tools/contracts";

/** Cap the replayed transcript so the seed turn stays within model limits. */
export const MAX_FORK_TRANSCRIPT_CHARS = 60_000;

type ForkMessage = Pick<OrchestrationMessage, "role" | "text" | "streaming">;

/** Render the source conversation into a plain-text transcript. */
export function buildForkTranscript(messages: ReadonlyArray<ForkMessage>): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.streaming) continue;
    if (message.role === "system") continue;
    const text = message.text.trim();
    if (text.length === 0) continue;
    const speaker = message.role === "user" ? "User" : "Assistant";
    lines.push(`${speaker}: ${text}`);
  }
  const transcript = lines.join("\n\n");
  if (transcript.length <= MAX_FORK_TRANSCRIPT_CHARS) {
    return transcript;
  }
  return `…(earlier messages omitted)…\n\n${transcript.slice(-MAX_FORK_TRANSCRIPT_CHARS)}`;
}

/**
 * Build the first-turn prompt for a forked thread: the prior conversation as
 * context plus an instruction to continue. Returns null when there is nothing
 * to replay (an empty source thread can't be forked).
 */
export function buildForkSeedPrompt(
  messages: ReadonlyArray<ForkMessage>,
  sourceTitle: string,
): string | null {
  const transcript = buildForkTranscript(messages);
  if (transcript.length === 0) {
    return null;
  }
  const title = sourceTitle.trim().length > 0 ? sourceTitle.trim() : "another chat";
  return [
    `This chat was forked from "${title}". The prior conversation is included below as context.`,
    "Pick up from where it left off. Begin with a one-line confirmation that you have the context, then wait for the next request.",
    "",
    "--- Prior conversation ---",
    transcript,
    "--- End of prior conversation ---",
  ].join("\n");
}

/** Title for the forked thread. */
export function buildForkThreadTitle(sourceTitle: string): string {
  const title = sourceTitle.trim();
  const base = title.length > 0 ? title : "chat";
  const withoutForkPrefix = base.replace(/^Fork of\s+/i, "");
  return `Fork of ${withoutForkPrefix}`;
}
