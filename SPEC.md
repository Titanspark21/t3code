# T3 Code — Fork Spec

A handoff document for any developer or AI agent picking up this fork. It
describes **what this fork is, what it's for, and how the changes are built** so
you can extend it without re-deriving everything. For build/update mechanics see
[`FORK_NOTES.md`](./FORK_NOTES.md); this file is the design/architecture spec.

## 1. What the base app is

**T3 Code** is an Electron desktop app (plus a mobile app, not used here) that
puts several terminal AI coding agents behind one UI. Each "provider" (Claude,
Codex, Cursor, Gemini, Amp, …) is a local CLI the app drives as a subprocess.

- Monorepo, **pnpm** workspace, TypeScript, **Effect** (effect-ts) throughout.
- `apps/server` — the backend that spawns and talks to each provider CLI.
- `apps/web` — the React UI (also bundled into the desktop app).
- `apps/desktop` — the Electron shell.
- `packages/contracts` — shared schemas/types (settings, provider models, …).
- Providers live in `apps/server/src/provider/` as **Driver** (lifecycle) +
  **Adapter** (session I/O) + **Provider** (status/health) + a manager.
- Lineage: `pingdotgg/t3code` → `aaditagrawal/t3code` (added Gemini) → **this
  fork** (`Titanspark21/t3code`).

## 2. What this fork is for

Run **multiple Claude accounts and multiple Google Antigravity accounts** inside
one install, each fully isolated (own login, history, rate limits), and make the
Antigravity integration real (not the deprecated Gemini CLI).

### 2a. Multiple isolated accounts per provider

The app already supports multiple _instances_ of a provider. This fork adds the
per-instance isolation knobs and one-click presets:

- **Claude** gained a **`configDir`** setting → exported as `CLAUDE_CONFIG_DIR`
  for that instance's subprocess. Point instance A at `~/.claude-1` and B at
  `~/.claude-2` → two independent Anthropic logins side by side.
- **Gemini/Antigravity** gained an **account profile dir** (`configDir`) →
  exported as `HOME` + `USERPROFILE` for the `agy` subprocess, because the
  Antigravity CLI has no config-dir flag and keys its identity off the home
  directory. `~/.gemini-1` / `~/.gemini-2` → two independent Antigravity logins.
- The **Add Provider** dialog offers presets that fill these in: _Claude 1/2_,
  _Antigravity 1/2_ (`apps/web/src/components/settings/providerProfilePresets.ts`).

### 2b. Gemini CLI → Antigravity (`agy`)

The old `gemini` CLI is deprecated for individuals; Antigravity (`agy`) replaces
it. The `geminiCli` provider now drives `agy` by default:

- An **`antigravity`** boolean setting (default **on**) switches the flavor. The
  legacy official Gemini CLI stays available when it's off.
- Antigravity runs in `--print` headless mode. It is **stateless per invocation**,
  so the manager reconstructs conversation context by replaying a compact
  transcript into each prompt (`buildAntigravityPrompt`), and maps T3 runtime
  modes to `agy` flags (`buildAntigravityArgs`: `--mode plan|accept-edits`, or
  `--dangerously-skip-permissions` for full access).
- Provider is surfaced as **"Antigravity (Gemini)"** with an `agy` badge.
- Built-in model list = what `agy models` reports (Gemini 3.5 Flash Low/Medium/
  High, Gemini 3.1 Pro Low/High, Claude Sonnet/Opus 4.6, GPT-OSS 120B). The
  model **slug is the display label** — `agy --model` resolves models by label,
  not by an id. `auto` is special-cased to omit `--model`.

## 3. Where the changes live (file map)

| Concern                                                                  | File(s)                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Claude `configDir`, Antigravity `antigravity`+`configDir`, patch schemas | `packages/contracts/src/settings.ts`                                                                     |
| Claude env (`CLAUDE_CONFIG_DIR`) + Claude executable resolution          | `apps/server/src/provider/Drivers/ClaudeHome.ts`                                                         |
| Antigravity env (`HOME`/`USERPROFILE` isolation)                         | `apps/server/src/provider/Drivers/GeminiCliHome.ts`                                                      |
| `agy` retarget, print-mode args, transcript replay, per-instance env     | `apps/server/src/geminiCliServerManager.ts`                                                              |
| geminiCli driver/adapter/provider wired to `agy` + models                | `apps/server/src/provider/{Drivers/GeminiCliDriver,Layers/GeminiCliAdapter,Layers/GeminiCliProvider}.ts` |
| Account-profile presets in Add-Provider dialog                           | `apps/web/src/components/settings/providerProfilePresets.ts`, `AddProviderInstanceDialog.tsx`            |
| Provider labels ("Antigravity (Gemini)")                                 | `providerDriverMeta.ts`, `session-logic.ts`                                                              |
| Claude auth-probe fix (use SDK bundled native binary)                    | `ClaudeHome.ts` (`resolveClaudeExecutablePath`), `ClaudeProvider.ts`, `ClaudeAdapter.ts`                 |
| **Desktop packaging fix** (see §4)                                       | `scripts/build-desktop-artifact.ts`                                                                      |
| Fork release workflow (retargeted, desktop-only)                         | `.github/workflows/release.yml`                                                                          |

## 4. Critical gotchas / non-obvious decisions

- **Windows packaging fix (why the app launches at all).** electron-builder v26's
  pnpm dependency collector drops ~150 duplicate/multi-version transitive deps
  (debug, express, cross-spawn, ajv, cors, …) → the app crashed on launch with
  _"Cannot find module 'debug'"_. This affects upstream builds too. Fix in
  `scripts/build-desktop-artifact.ts`: hoist the staged install
  (`nodeLinker: hoisted`), an **`afterPack` hook** copies dropped deps back in,
  and the Windows app ships **without asar** (`asar: false`) so modules resolve
  from the real filesystem (Electron's asar `require` never consults a file with
  no asar index entry, so restored-but-unindexed modules would stay invisible).
  If the app ever fails to open after a build, start here.
- **Local Windows builds need `pwd` on PATH** (run from Git Bash) — electron-
  builder shells out to `pwd`; without it the build is silently broken. Cloud CI
  runs under bash so it's fine there.
- **Claude auth "Could not verify authentication status".** The Claude Agent SDK
  requires a _native_ Claude binary. The default `binaryPath` ("claude") is an
  npm shim (`claude.ps1`/`.cmd`), which the SDK rejects. Fix: pass
  `pathToClaudeCodeExecutable` only for an explicit custom path; otherwise omit
  it so the SDK uses its own bundled native binary (`resolveClaudeExecutablePath`).
- **`gemini.ts` must not import the store** (load-order cycle) — Antigravity/Groq
  config is injected via a getter. (Inherited from the upstream Gemini work.)
- **Per-instance env must reach the subprocess.** The Gemini adapter used to drop
  the injected environment before spawning; account isolation depends on it now
  being propagated (`geminiCliServerManager` `environment`).

## 5. Working on this fork

- `origin` = your fork (`Titanspark21/t3code`), `main` = your line of changes.
- `upstream` = `aaditagrawal/t3code`. Pull updates with
  `git fetch upstream && git merge upstream/main`; conflicts are most likely in
  `release.yml` (repo name), the geminiCli files, and `build-desktop-artifact.ts`.
- Verify: `pnpm tc` (typecheck), `pnpm test`. Build a Windows installer from Git
  Bash with `pnpm dist:desktop:win:x64` (lands in `release/`), or use the cloud
  release workflow.
