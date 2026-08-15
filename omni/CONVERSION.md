# OmniLink → OmniCode: what happened and why

This repo is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT).
It replaces **OmniLink**, a from-scratch build that ran ~28k lines of TypeScript over
about a year and never shipped.

Read this once. After that, `omni/PLAN.md` is the live worklist and `OMNI.md` is the
merge discipline.

## 1. Why OmniLink was abandoned

Not because the design was wrong. OmniLink's `SPEC.md` is a good product spec and most of
it survives — it's the requirements document for this fork. It was abandoned because
building the whole stack alone was taking forever, and t3code already ships most of it:

Already done upstream, still open boxes in OmniLink's `PLAN.md`:

- five live providers behind one adapter interface
- multi-account per provider, including the Codex shared-home + shadow-home pattern
  OmniLink flagged as an unproven spike (`SPEC.md` §5.7)
- per-turn checkpoints as hidden git refs, with revert — and it reverts the *provider
  conversation* too, not just the working tree
- the whole workspace inspector: diff, file tree + preview, browser preview, terminal
  tabs and splits
- worktrees, branch toolbar, worktree cleanup
- command palette and fully customisable keybindings
- **the entire M3 remote milestone** — LAN, Tailscale Serve HTTPS, SSH-launched remote
  environments, tunnel, pairing by QR/token
- signed auto-updating desktop, distributed via winget / Homebrew / AUR
- native iOS and Android apps
- the event-sourced typed-contract architecture OmniLink `SPEC.md` §4.3 describes and
  P1-06/P1-07 were still trying to build

Against that, OmniLink had eleven open P0–P2 audit items and a final commit where an
agent handed back a PR unable to install dependencies.

## 2. The one thing that actually changed

**OmniLink drove the real interactive TUI in a PTY. T3 Code does not run a TUI at all.**

| | OmniLink | T3 Code |
|---|---|---|
| Claude | `claude` TUI in a PTY | `@anthropic-ai/claude-agent-sdk` |
| Codex | `codex` TUI in a PTY | app-server JSON-RPC (`packages/effect-codex-app-server`) |
| Cursor / Grok / OpenCode | — | ACP (`packages/effect-acp`) |
| Chat content | parsed from each CLI's transcript files on disk | the server's own event log |
| Terminals | the agent's own PTY, shown in xterm | separate user shells (`apps/server/src/terminal/`) |

OmniLink `SPEC.md` §4.2 explicitly forbade this ("Do not build on ... the Agent SDK").
That rule was hedging against Anthropic moving SDK usage off subscription limits onto
metered credits — a change OmniLink's own spec records as **paused on 15 June 2026 and
never reinstated**. T3 Code ships the SDK path to a very large user base on subscriptions
today. The rule is retired. That is the single decision this whole fork rests on.

### What died with it

None of this ports. Read it for findings, then let it go:

- `server/src/transcripts/` — three transcript parsers, the schema-less protobuf wire
  reader, the agy SQLite + `-wal` watcher, unknown-block labelling
- `server/src/pty/` — the PTY factory, delayed-Enter slash-command injection,
  auto-confirming Claude's "Switch model?" dialog, shared PTY sizing across windows
- `server/src/permissions/` — the PTY-level approval parser and auto-answer
- the Chat/Terminal toggle over one session, and auto-flip to Terminal on `/`

The event log is strictly better than transcript parsing: ordered, durable, complete,
immune to provider format drift. Losing the parsers is a win, not a sacrifice.

### What survives

The research, and the product judgement:

- every verified on-machine finding in OmniLink `SPEC.md` §13 — agy 1.1.5 flags and model
  list, Codex 0.145.0 rollout format and `turn_context`, mode flag mappings per provider,
  the `USERPROFILE` isolation recipe, the `CLAUDECODE` environment-variable trap
- the calls that were right: no AI-guessed quota numbers, no automatic account rotation,
  quota groups as the unit of choice, checkpoints over approval dialogs
- `SPEC.md` §7 (UI) and §8 (features) as the description of what "finished" looks like

OmniLink lives at `Titanspark21/omnilink`. Its `T3CODE-MIGRATION.md` holds the long-form
comparison this document summarises.

## 3. The previous fork-of-a-fork

Before this, there was `Titanspark21/t3code` — a fork of
[aaditagrawal/t3code](https://github.com/aaditagrawal/t3code), which had itself squashed
pingdotgg's entire history into one commit. That meant **no shared git history with
upstream**: `git merge-base` was empty, merging pingdotgg was an unrelated-histories
conflict on every file, and the only update path was cherry-picking. That fork is a dead
end by construction, which is why this one starts clean from pingdotgg.

Everything from it is preserved in `omni/salvage/`:

| File | What it is |
|---|---|
| `titanspark21-fork.patch` | full diff of all six of your commits |
| `old-fork-commits.bundle` | the six commits as real git objects, authors and dates intact. The old repo is deleted, so this is the only remaining copy. Restore with `git fetch omni/salvage/old-fork-commits.bundle refs/heads/main:old-fork` |
| `OLD-FORK-SPEC.md` | your design spec for the agy integration |
| `OLD-FORK_NOTES.md` | setup + build notes, incl. the electron-builder packaging fix |
| `src/.../GeminiCliHome.ts` | per-instance `HOME`/`USERPROFILE` isolation for agy |
| `src/.../geminiCliServerManager.ts` | the `agy --print` session manager |
| `src/.../providerProfilePresets.ts` | one-click Claude 1/2, Antigravity 1/2 presets |
| `src/.../ClaudeHome.ts` | your `CLAUDE_CONFIG_DIR` work |

Three notes on reusing it:

1. **The Claude multi-account work is now redundant.** Upstream ships `CLAUDE_CONFIG_DIR`
   per instance (`apps/server/src/provider/Drivers/ClaudeHome.ts`, documented in
   `docs/user/providers-claude.md`). Don't port it.
2. **The agy isolation has a real bug.** `makeGeminiCliEnvironment` overrides `HOME` and
   `USERPROFILE` and passes nothing back. On Windows that redirects *every* child process
   in the tree — `git` looks for `.gitconfig` in the profile dir, `ssh` for keys, `npm` for
   its cache. Expect commits with no author and push failures. OmniLink `SPEC.md` §5.2 has
   the fix: override `USERPROFILE` only, and pass `HOME`, `APPDATA`, `LOCALAPPDATA` and
   `GIT_CONFIG_GLOBAL` **back to the real profile**.
3. **It runs agy with `--dangerously-skip-permissions`** whenever the mode isn't plan or
   accept-edits (`geminiCliServerManager.ts`, `buildAntigravityArgs`). That is the guardrail
   gap — see PLAN item A2.

## 4. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| 1 | Retire OmniLink `SPEC.md` §4.2, fork t3code | The metering risk it guarded never materialised; this is the only path that ships |
| 2 | Keep every upstream feature, disable nothing | PR client, SSH environments, cloud, mobile app — all excluded by OmniLink `SPEC.md` §1.1, all shipped upstream. Hiding them costs merge conflicts forever; ignoring them costs nothing |
| 3 | Build agy | The one genuinely unique provider. Harder than it looks — see PLAN §A |
| 4 | No permission rule engine | Upstream's four modes are enough for Claude and Codex. agy gets targeted guardrails instead |
| 5 | Use the upstream mobile app, no PWA | It's free from the stores, it's good, and it talks to this fork's server. A PWA would duplicate it for no gain |
| 6 | Keep upstream's AI-generated titles | OmniLink `SPEC.md` §8.8 banned them on cost grounds; upstream's are better and the cost is trivial |
| 7 | `main` mirrors upstream, work on `omni/main`, merge weekly | See `OMNI.md` |
| 8 | Audit OmniLink's git history for chat data before archiving it | OmniLink `PLAN.md` P2-12 flags tracked `.db-wal` / `.db-shm` journals |

## 5. Two things to expect

**You are now writing Effect.** Every server change goes through Effect/Schema, an
event-sourced engine and Atom client state. Upstream's `AGENTS.md` tells agents to read
`.repos/effect-smol/LLMS.md` before writing server code. There is no partial adoption of
this — it's the spine.

**The toolchain is Vite+ (`vp`), not plain pnpm.** Every build, test, lint and typecheck
script runs through it, and it needs a global `vp` binary installed by a curl script. It's
VoidZero's commercial product, not part of the MIT repo. **Confirm its licence terms cover
your use before investing further** — that's task S1 in the plan, deliberately first.
