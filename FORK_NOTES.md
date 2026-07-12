# T3 Code — Titanspark21 fork

This is a personal fork of [aaditagrawal/t3code](https://github.com/aaditagrawal/t3code)
(itself a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code)).

## What this fork adds

Run **multiple Claude and Gemini/Antigravity CLI accounts** inside one T3 Code
install, each fully isolated (separate login, history, and rate limits).

- **Claude** provider gained a **Config directory** field. It sets
  `CLAUDE_CONFIG_DIR` for that instance, so pointing one instance at
  `~/.claude-1` and another at `~/.claude-2` gives you two independent Anthropic
  logins side by side.
- **Gemini** provider now drives Google **Antigravity (`agy`)** by default
  (toggle in its settings; the old official `gemini` CLI stays available behind
  the switch). Its **Account profile directory** field sets `HOME`/`USERPROFILE`
  for that instance, so `~/.gemini-1` and `~/.gemini-2` are two independent
  Antigravity logins.
- The **Add Provider** dialog has one-click presets: **Claude 1**, **Claude 2**,
  **Antigravity 1**, **Antigravity 2** — each fills the right directory for you.

## One-time setup on your machine

These must already exist and be logged in (the app just points at them; it does
not create or authenticate them):

1. `claude` CLI on your PATH, with two logged-in config dirs:
   - `CLAUDE_CONFIG_DIR=~/.claude-1 claude` → log in as account 1
   - `CLAUDE_CONFIG_DIR=~/.claude-2 claude` → log in as account 2
2. `agy` (Antigravity) CLI on your PATH, with two logged-in profiles:
   - launch `agy` with `USERPROFILE` pointed at `~/.gemini-1` → log in as account 1
   - same with `~/.gemini-2` → log in as account 2

Then in T3 Code: **Settings → Add Provider →** pick **Claude** or
**Antigravity (Gemini)** → click a preset (Claude 1/2, Antigravity 1/2) → Save.
Add all four to have every account available.

## Getting the desktop app (.exe)

Two ways:

- **Cloud build (recommended for updates):** enable **Actions** on this repo
  once (Actions tab → enable), then **Actions → "Release Desktop" → Run
  workflow**, enter a version like `1.0.0`. GitHub builds **Windows, macOS,
  Linux, and an Android APK** and publishes them under **Releases**. Free, no
  local toolchain. (The Android APK is built with an ephemeral key and the cloud
  "T3 Connect" features off; it still works via **local pairing** — scan the
  desktop's QR or enter its host + pairing code over your LAN or Tailscale.)
- **Local build:** `pnpm install` then `pnpm dist:desktop:win:x64`. The
  installer lands in `release/`. **Run this from Git Bash** (or otherwise have
  Git's `pwd` on your PATH) — electron-builder's dependency step shells out to
  `pwd`, which PowerShell/cmd don't provide, and without it the packaged app is
  silently missing modules. The cloud build already runs under bash, so this
  only matters for local builds.

The build is **unsigned**, so Windows SmartScreen shows "Windows protected your
PC" on first run → click **More info → Run anyway**. This is expected for a
personal build.

### Packaging fix (why builds work here)

electron-builder v26's pnpm dependency collector drops ~150 transitive
dependencies (`debug`, `express`, `cross-spawn`, `ajv`, …) from the packaged
app, so a stock build crashes on launch with _"Cannot find module 'debug'"_ —
this is almost certainly why upstream-built `.exe`s failed to open. This fork
fixes it in `scripts/build-desktop-artifact.ts`: the staged install is hoisted
(flat `node_modules`), an `afterPack` hook copies back any dropped dependency,
and the Windows app ships without asar so every module resolves from the real
filesystem. If you merge upstream and the app starts failing to open again,
that fix is what to re-check.

## Keeping your changes up to date

Your changes live on `main`. Remotes:

- `origin` = your fork (`Titanspark21/t3code`).
- `upstream` = **`aaditagrawal/t3code`** — the fork this is based on (it added the
  Gemini/Antigravity foundation). This is the **only clean-merge source**.
- `pingdotgg` = **`pingdotgg/t3code`** — the original project. Reference only,
  see the caveat below.

**Normal update (from `upstream` / aaditagrawal):**

```bash
git fetch upstream
git merge upstream/main      # resolve conflicts (likely release.yml repo name,
                             # the geminiCli files, build-desktop-artifact.ts)
git push origin main
```

Then rebuild (cloud or local) to get updated installers.

**Why you can't cleanly pull from the original (`pingdotgg`).** aaditagrawal
**squashed the entire project into a single commit** when they forked, so this
fork shares **no git history** with `pingdotgg` (`git merge-base HEAD
pingdotgg/main` is empty; a plain merge would treat them as _unrelated
histories_ and conflict on essentially every file). The Antigravity/Gemini and
multi-provider features you rely on only exist in aaditagrawal's line, not in
`pingdotgg`. So to bring in a specific fix from the original, **cherry-pick it**
rather than merge:

```bash
git fetch pingdotgg
git log pingdotgg/main            # find the commit you want
git cherry-pick <commit-sha>      # apply just that change (resolve conflicts)
```

A full re-base onto `pingdotgg` is possible but is a large one-time re-port of
all the fork's changes — only worth it if you want to abandon aaditagrawal's line
entirely.
