// @effect-diagnostics nodeBuiltinImport:off - pure path/env helpers, no Effect runtime here.
/**
 * Per-instance account isolation for Antigravity (`agy`).
 *
 * `agy` has no config-directory flag: it resolves credentials, its database and
 * all local state from the user's **home directory**. Running two accounts side
 * by side therefore means pointing each session's home at a different tree.
 *
 * ## The blast radius this module exists to contain
 *
 * Redirecting home redirects *every* child process the agent spawns, not just
 * `agy`. Left unguarded, `git` looks for `.gitconfig` inside the isolated
 * profile, `ssh` looks for keys there, and npm uses a different cache. The
 * observable symptoms are commits with no author, push failures, and npm
 * re-downloading the world — and they show up as "the agent is broken", not as
 * "the profile is wrong", which is what makes this worth handling carefully.
 *
 * The previous fork of this project overrode `HOME` *and* `USERPROFILE` with no
 * passthrough and hit exactly that. This module is the corrected version.
 *
 * ## How the two platforms differ
 *
 * **Windows** is the clean case. `agy` reads `USERPROFILE`; Git for Windows
 * prefers `HOME` and falls back to `USERPROFILE`. So overriding `USERPROFILE`
 * alone isolates the account, while `HOME`, `APPDATA`, `LOCALAPPDATA` and
 * `GIT_CONFIG_GLOBAL` pinned back at the real profile keep git, gh, ssh and npm
 * pointed at the real user. Nothing is lost.
 *
 * **POSIX** cannot be made perfect. `HOME` is the only selector `agy` honours,
 * so it must move, and everything keyed off `HOME` moves with it. We pin back
 * what has an explicit environment override — git identity and credentials via
 * `GIT_CONFIG_GLOBAL`, the npm cache via `npm_config_cache` — and deliberately
 * do **not** invent an `ssh` workaround: guessing at key filenames to build a
 * `GIT_SSH_COMMAND` fails differently and more confusingly than the honest
 * behaviour. `antigravityIsolationCaveats` reports what remains redirected so
 * the UI can say so plainly instead of letting the user discover it mid-push.
 *
 * @module provider/Drivers/AntigravityHome
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expandHomePath } from "../../pathExpansion.ts";

/** Settings this module needs. Kept structural so tests need no schema. */
export interface AntigravityProfileSettings {
  readonly profileDir: string;
}

export interface AntigravityEnvironmentOptions {
  /** Defaults to `process.platform`. Injected so both branches are testable. */
  readonly platform?: NodeJS.Platform;
  /** Defaults to `os.homedir()`. */
  readonly realHome?: string;
}

/**
 * Absolute isolated profile directory, or `undefined` when this instance uses
 * the machine's default Antigravity login.
 */
export function resolveAntigravityProfileDir(
  config: AntigravityProfileSettings,
): string | undefined {
  const trimmed = config.profileDir.trim();
  if (trimmed.length === 0) return undefined;
  return NodePath.resolve(expandHomePath(trimmed));
}

/**
 * Environment for a spawned `agy` (or ACP bridge) process.
 *
 * Returns `baseEnv` untouched when no profile is configured — the default
 * account needs no isolation, and rewriting the environment anyway would be a
 * gratuitous difference between the two paths.
 */
export function makeAntigravityEnvironment(
  config: AntigravityProfileSettings,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: AntigravityEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const profileDir = resolveAntigravityProfileDir(config);
  if (!profileDir) return baseEnv;

  // oxlint-disable-next-line t3code/no-global-process-runtime -- Pure helper keeps platform injectable for tests and non-Effect callers.
  const platform = options.platform ?? process.platform;
  const realHome =
    options.realHome ?? baseEnv["HOME"] ?? baseEnv["USERPROFILE"] ?? NodeOS.homedir();

  // Git identity is the first thing to break and the most confusing when it
  // does, so it is pinned back on both platforms. An explicit value already in
  // the environment wins — the user meant it.
  const gitConfigGlobal = baseEnv["GIT_CONFIG_GLOBAL"] ?? NodePath.join(realHome, ".gitconfig");

  if (platform === "win32") {
    return {
      ...baseEnv,
      // The isolation itself: agy reads USERPROFILE.
      USERPROFILE: profileDir,
      // Everything else stays with the real user.
      HOME: realHome,
      ...(baseEnv["APPDATA"] ? { APPDATA: baseEnv["APPDATA"] } : {}),
      ...(baseEnv["LOCALAPPDATA"] ? { LOCALAPPDATA: baseEnv["LOCALAPPDATA"] } : {}),
      GIT_CONFIG_GLOBAL: gitConfigGlobal,
    };
  }

  return {
    ...baseEnv,
    // POSIX has no separate selector — HOME is the isolation.
    HOME: profileDir,
    GIT_CONFIG_GLOBAL: gitConfigGlobal,
    // npm's cache is only a performance concern, but re-downloading every
    // dependency inside an agent turn is slow enough to look like a hang.
    npm_config_cache: baseEnv["npm_config_cache"] ?? NodePath.join(realHome, ".npm"),
  };
}

/** Home directory where `agy` writes profile state and diagnostic logs. */
export function resolveAntigravityDataHome(
  config: AntigravityProfileSettings,
  environment: NodeJS.ProcessEnv = process.env,
  options: AntigravityEnvironmentOptions = {},
): string {
  const profileDir = resolveAntigravityProfileDir(config);
  if (profileDir) return profileDir;

  // oxlint-disable-next-line t3code/no-global-process-runtime -- Pure helper keeps platform injectable for tests and non-Effect callers.
  const platform = options.platform ?? process.platform;
  return (
    (platform === "win32"
      ? (environment["USERPROFILE"] ?? environment["HOME"])
      : (environment["HOME"] ?? environment["USERPROFILE"])) ??
    options.realHome ??
    NodeOS.homedir()
  );
}

/**
 * Human-readable list of what stays redirected for this instance, for the
 * settings UI. Empty when nothing is compromised.
 *
 * Being able to state this is the point: an isolation scheme with a known gap
 * that is surfaced is fine; the same gap discovered during a failed push is not.
 */
export function antigravityIsolationCaveats(
  config: AntigravityProfileSettings,
  options: AntigravityEnvironmentOptions = {},
): ReadonlyArray<string> {
  if (!resolveAntigravityProfileDir(config)) return [];
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Pure helper keeps platform injectable for tests and non-Effect callers.
  const platform = options.platform ?? process.platform;
  const sharedKeyring =
    "AGY authenticates through the operating system keyring. Separate profile folders can still use the same signed-in account; check the authenticated email shown above.";
  if (platform === "win32") return [sharedKeyring];
  return [
    sharedKeyring,
    "SSH keys resolve from this profile directory, not your real home. If the agent pushes over SSH, either copy your keys in or use an HTTPS remote.",
  ];
}

/**
 * Continuation group key — decides whether an existing thread may switch to
 * another Antigravity instance.
 *
 * Keyed on the resolved profile directory, so two instances pointed at the same
 * profile are interchangeable and two pointed at different logins are not.
 * Antigravity keeps conversation history inside the profile, so a thread
 * started under one login genuinely cannot be resumed under another.
 */
export function makeAntigravityContinuationGroupKey(
  config: AntigravityProfileSettings,
  options: AntigravityEnvironmentOptions = {},
): string {
  const profileDir = resolveAntigravityProfileDir(config) ?? options.realHome ?? NodeOS.homedir();
  return `antigravity:profile:${profileDir}`;
}
