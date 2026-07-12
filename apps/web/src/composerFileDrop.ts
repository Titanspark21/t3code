/**
 * Helpers for dropping / pasting non-image files into the composer.
 *
 * Images keep their existing attachment path. Every other file is inlined into
 * the prompt as a labeled, fenced code block so the content reaches the agent
 * as plain text. That works for every provider — including Antigravity / Gemini,
 * whose adapter rejects binary attachments — without touching the attachment
 * schema or per-provider upload transport.
 *
 * @module composerFileDrop
 */

/** Largest file we inline. Bigger files bloat the prompt; reference by path. */
export const MAX_COMPOSER_FILE_BYTES = 512 * 1024;

/** Cap the number of files inlined from a single drop/paste. */
export const MAX_COMPOSER_FILES = 10;

const NUL_CHAR_CODE = 0;
const REPLACEMENT_CHAR_CODE = 0xfffd;

/**
 * Heuristic binary check for text decoded as UTF-8. A NUL byte or a high
 * density of replacement characters means the source was not text.
 */
export function looksBinary(content: string): boolean {
  if (content.length === 0) return false;
  const sample = content.length > 4096 ? content.slice(0, 4096) : content;
  let suspicious = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);
    if (code === NUL_CHAR_CODE) return true;
    if (code === REPLACEMENT_CHAR_CODE) suspicious += 1;
  }
  return suspicious / sample.length > 0.1;
}

/**
 * Pick a backtick fence long enough to wrap `content` without a premature
 * close — one longer than the longest backtick run inside it (min three).
 */
export function codeFenceFor(content: string): string {
  const runs = content.match(/`+/g);
  const longest = runs ? Math.max(...runs.map((run) => run.length)) : 0;
  return "`".repeat(Math.max(3, longest + 1));
}

/** Build the fenced block appended to the composer for one dropped file. */
export function buildDroppedFileBlock(name: string, content: string): string {
  const label = name.trim().length > 0 ? name.trim() : "file";
  const fence = codeFenceFor(content);
  const body = content.endsWith("\n") ? content : `${content}\n`;
  return `\n${label}:\n${fence}\n${body}${fence}\n`;
}

export interface DroppedFileTextResult {
  readonly blocks: ReadonlyArray<string>;
  readonly error: string | null;
}

export interface DroppedFileLike {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}

/**
 * Read the given (already non-image) files into fenced prompt blocks, enforcing
 * the size / count / binary guards. Returns the blocks to append plus the first
 * user-facing error encountered (if any), mirroring `addComposerImages`.
 */
export async function readDroppedFilesAsBlocks(
  files: ReadonlyArray<DroppedFileLike>,
  alreadyInlinedCount = 0,
): Promise<DroppedFileTextResult> {
  const blocks: string[] = [];
  let error: string | null = null;
  let count = alreadyInlinedCount;

  for (const file of files) {
    if (count >= MAX_COMPOSER_FILES) {
      error = `You can add up to ${MAX_COMPOSER_FILES} files per message.`;
      break;
    }
    if (file.size > MAX_COMPOSER_FILE_BYTES) {
      error = `'${file.name}' is larger than ${Math.round(
        MAX_COMPOSER_FILE_BYTES / 1024,
      )} KB. Reference it by path instead of dropping it in.`;
      continue;
    }
    let content: string;
    try {
      content = await file.text();
    } catch {
      error = `Could not read '${file.name}'.`;
      continue;
    }
    if (looksBinary(content)) {
      error = `'${file.name}' looks like a binary file, so it can't be added as text.`;
      continue;
    }
    blocks.push(buildDroppedFileBlock(file.name, content));
    count += 1;
  }

  return { blocks, error };
}
