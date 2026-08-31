// @effect-diagnostics nodeBuiltinImport:off
/**
 * Which Antigravity account an instance is actually signed in as.
 *
 * ## Why this exists
 *
 * `AntigravityHome` isolates an instance by pointing `HOME` at a profile
 * directory. That controls where `agy` keeps its state, but on current builds
 * it does **not** control which account it authenticates as: `agy` resolves its
 * credentials from an OS-level store outside the home directory, so several
 * instances configured with different profiles can all be the same account.
 * Verified on Linux with `agy 1.1.22` — an empty `HOME` and a clean
 * environment still signed in as the machine's logged-in Antigravity user.
 *
 * The consequence for quota is the thing worth fixing: five configured
 * instances publish five identical snapshots, and the panel presents one
 * account's usage as five independent accounts. Reading the identity lets the
 * UI say "these share an account" instead of quietly repeating a number.
 *
 * The CLI does not print its account anywhere machine-readable, so this reads
 * the identity it logs at startup. That is a diagnostic file and may go away,
 * which is why every failure here is silent: an unknown account is a missing
 * label, never a wrong one.
 *
 * @module provider/Drivers/AntigravityAccount
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

/** `applyAuthResult: email=someone@example.com, authMethod=consumer, ...` */
const AUTH_RESULT = /applyAuthResult:\s*email=([^\s,]+)/gu;

/**
 * The account the CLI last reported in a log, or `undefined`.
 *
 * The last match wins: a log can span a re-login, and the most recent line is
 * the account the next turn will use.
 */
export function parseAntigravityAccountEmail(logText: string): string | undefined {
  let found: string | undefined;
  for (const match of logText.matchAll(AUTH_RESULT)) {
    const email = match[1]?.trim();
    if (email && email.includes("@")) found = email;
  }
  return found;
}

/** Log directory `agy` writes under a given home. */
export function antigravityLogDirectory(home: string): string {
  return NodePath.join(home, ".gemini", "antigravity-cli", "log");
}

/** How much of a log tail is read; the identity is logged during startup. */
const LOG_TAIL_BYTES = 128 * 1024;

/**
 * Read the account identity from the newest CLI log under `home`.
 *
 * Only the newest log, and only its tail: these files reach megabytes during
 * real work. Every failure resolves to `undefined` — an unknown account is a
 * missing label, never a wrong one.
 */
export async function readAntigravityAccountEmail(home: string): Promise<string | undefined> {
  const directory = antigravityLogDirectory(home);
  let newest: { readonly path: string; readonly modifiedMs: number } | undefined;
  try {
    for (const entry of await NodeFSP.readdir(directory)) {
      if (!entry.endsWith(".log")) continue;
      const candidate = NodePath.join(directory, entry);
      try {
        const info = await NodeFSP.stat(candidate);
        if (!newest || info.mtimeMs > newest.modifiedMs) {
          newest = { path: candidate, modifiedMs: info.mtimeMs };
        }
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  if (!newest) return undefined;

  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(newest.path, "r");
  } catch {
    return undefined;
  }
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
    const length = stat.size - start;
    if (length <= 0) return undefined;
    const buffer = Buffer.alloc(Number(length));
    await handle.read(buffer, 0, buffer.length, start);
    return parseAntigravityAccountEmail(buffer.toString("utf8"));
  } catch {
    return undefined;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
