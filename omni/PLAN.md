# OmniCode — worklist

Only unfinished work lives here. `omni/CONVERSION.md` explains why this fork exists and
what was decided; `OMNI.md` is the merge discipline. Delete a task when it's done — git
history is the changelog.

Product requirements come from OmniLink's `SPEC.md` (`Titanspark21/omnilink`), specifically
§7 (UI), §8 (features) and §13 (verified on-machine findings). Where this plan and that
spec disagree, this plan wins — see `omni/CONVERSION.md` §2 for what changed.

**Rule for every task below: add files, don't edit them.** Read `OMNI.md` before you touch
anything that already exists.

---

## Stage 0 — prove the ground before building on it

Nothing else starts until these pass. Both can fail in ways that change the whole plan.

- [ ] **S1 — Get the toolchain running on Windows, and settle the Vite+ licence.**
      Install `vp` (`irm https://vite.plus/ps1 | iex`), then `vp i`, then `vp run dev`.
      Open the app, connect Claude and Codex, send a real turn.
      **Before writing any code, confirm Vite+'s terms cover your use.** The current answer is
      recorded in `omni/TOOLCHAIN.md`: Vite+ is now MIT-licensed open source, so the earlier
      commercial/source-available concern no longer blocks this fork.
      _Gate: the app runs from source on your Windows machine and the licence question has
      a written answer._
  - [x] `vp` installed; its shim supplies Node 24.19, satisfying the repo's `^24.13.1`.
  - [x] `vp i` succeeds — **but only as `vp i --filter=!@t3tools/mobile`.** A plain
        `vp i` dies with `ERR_PNPM_EPERM` while unpacking Expo packages
        (`expo-camera`, then `expo-paste-input`), and a retry just moves the failure to a
        different package. It is _not_ the Windows path limit — long paths are enabled
        and Node copies a 334-char path here, while the failures were at 290. It's
        Defender's real-time scanner locking prebuilt native mobile binaries (an iOS
        `.dSYM` bundle, a compiled Android `.dex`) mid-copy. Excluding the mobile
        workspace removes the whole failure class and costs nothing, since the decision
        is to use upstream's published mobile app rather than build it. Use that flag
        for every install, including after upstream syncs.
  - [x] Licence question — answered from VoidZero/Vite+ primary sources in
        `omni/TOOLCHAIN.md`: Vite+ is free/open source under MIT as of 2026-08-15.
  - [x] Run the source checkout on Windows — migrations complete, the backend listens, and
        Vite+ serves the web client from the isolated worktree home.
  - [x] Real Codex turn through the product — the orchestration HTTP API completed an actual
        `gpt-5.6-sol` turn and projected its native usage into `context-window.updated`
        (`23,942 / 258,400` tokens observed during the probe).
  - [ ] Real Claude turn — environment blocker, not a product failure: Claude Code `2.1.233`
        is installed but `claude auth status` reports `loggedIn: false`, `authMethod: none`;
        both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` are unset. Authenticate Claude
        on this Windows account, then rerun the source-product turn gate.

- [ ] **S2 — Use it as-is for a week.** Real work, Claude and Codex, no changes.
      This is a task, not a suggestion. Half of Stage 2 may stop mattering once you've
      lived with the thing, and you'll find out which parts of OmniLink's spec you actually
      miss versus which you only think you miss.
      _Gate: a written list of what genuinely annoyed you, in priority order. Re-order the
      rest of this plan against it._

---

## Stage A — Antigravity (`agy`)

The one provider upstream doesn't have. Upstream ships five drivers registered in
`apps/server/src/provider/builtInDrivers.ts`; their docs say adding one needs "no
orchestration, contract, or client change."

### Set expectations first

In OmniLink, agy was just a PTY — run `agy`, you get the real TUI, done. **That path does
not exist here.** t3code has no TUI; the server must speak a machine protocol to the agent.
So "type `agy-1` and boom, there's an agent" needs a transport underneath it, and which
transport you get decides how good the result is:

| Transport                                                                                                              | Cost                                  | What you get                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ACP** — if `agy` speaks it                                                                                           | ~1,200 lines, like `CursorAdapter.ts` | Everything. Streaming, tool calls, approvals, interrupts. Reuses `packages/effect-acp`                                                                                                           |
| **`agentapi` HTTP wrapper** — `<profile>\.gemini\antigravity-cli\bin\agentapi.bat`, recorded in OmniLink `SPEC.md` §11 | medium                                | Probably streaming and tools; approvals uncertain                                                                                                                                                |
| **`agy --print` one-shot per turn** — what the old fork did                                                            | ~600 lines, already salvaged          | Works, but: no streaming (the whole reply lands at once), no tool-call visibility, no approval prompts, and the entire conversation is replayed into every prompt — which burns quota and drifts |

- [ ] **A1 — Spike: find out which transport `agy` actually supports.**
      Check in that order: ACP first, then `agentapi`, then `--print`. Run `agy --help`,
      look for an ACP/experimental-acp flag, and try `agentapi.bat`.
      OmniLink `SPEC.md` §13.6 has the verified 1.1.5 flag set: `--continue`/`-c`,
      `--conversation <ID>`, `--model`, `--effort low|medium|high`,
      `--mode accept-edits|plan`, `--project`, `--prompt-interactive`, `--sandbox`.
      _Gate: a written answer naming the transport and why, before any adapter code._

- [ ] **A2 — Write the driver + adapter.** New files only:
      `apps/server/src/provider/Drivers/AntigravityDriver.ts`,
      `apps/server/src/provider/Layers/AntigravityAdapter.ts`,
      `.../Layers/AntigravityProvider.ts`, plus **one line** in `builtInDrivers.ts`.
      Model the shape on `CursorDriver.ts` + `CursorAdapter.ts` (ACP) or `OpenCodeDriver.ts`.
      Three things the old fork got wrong — fix them here: 1. **Account isolation must not break git.** Override `USERPROFILE` only, and pass
      `HOME`, `APPDATA`, `LOCALAPPDATA` and `GIT_CONFIG_GLOBAL` back to the _real_
      profile (OmniLink `SPEC.md` §5.2). The salvaged `GeminiCliHome.ts` overrides both
      `HOME` and `USERPROFILE` with no passthrough, which redirects every child process —
      expect commits with no author, push failures, and npm re-downloading everything. 2. **Never emit `--dangerously-skip-permissions`.** The old fork sends it for every
      full-access turn. Map upstream's modes to `--mode plan` / `--mode accept-edits`,
      and for full access send no permission flag at all rather than the bypass. This is
      the "extra guardrails for agy" decision. 3. **Read models from `agy models`, not a hardcoded list.** agy changes fast; a
      hardcoded catalogue rots silently. Note effort is baked into some model ids _and_
      settable via `--effort` — reconcile in the picker (OmniLink `PLAN.md` records this).
      _Gate: two isolated agy accounts run concurrently; a turn in one writes only into its
      own profile dir; `git commit` inside an agy session has the right author._

- [ ] **A3 — Account presets in the Add Provider dialog.** One-click "Antigravity 1/2"
      filling the profile dir, as the old fork had (`omni/salvage/src/.../providerProfilePresets.ts`).
      Note upstream already has a stubbed, disabled `gemini` driver kind in
      `AddProviderInstanceDialog.tsx` — decide whether to take that slot or add your own.

- [ ] **A4 — First-run trust prompt.** A fresh agy session in a new project asks "Do you
      trust the contents of this project?". It must surface to you, never be auto-answered.

---

## Stage B — Quota panel

The highest value-per-effort work in this plan, and it's half-built upstream already.

Upstream's Usage page is token-_cost_ analytics (`docs/user/usage.md`), not subscription
window state. But both adapters already emit the event and **nothing consumes it**:

- `apps/server/src/provider/Layers/CodexAdapter.ts:1395` — `account/rateLimits/updated`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts:3477` — same
- `packages/contracts/src/providerRuntime.ts:239,702` — `account.rate-limits.updated`,
  payload typed `Schema.Unknown`
- nothing in `apps/server/src/orchestration/` handles it

Because the providers push it, **no probe sessions are needed** — OmniLink `SPEC.md` §8.6.3's
hidden-probe machinery is unnecessary here. That's a straight win.

- [ ] **B1 — Type the payload and project it.** New contract file
      `packages/contracts/src/quota.ts` — do **not** edit `orchestration.ts` (see `OMNI.md`).
      Per account: one or more quota groups, each with 5-hour and weekly used-% and reset
      time, plus a `source` field recording how the number was obtained.
      _Gate: real Codex and Claude figures land in the read model._

- [ ] **B2 — The panel.** Always-visible, bottom-left, grouped by provider then account,
      using each account's display name and accent colour (OmniLink `SPEC.md` §7.5).
      Reset countdowns on hover, click a row to refresh.
      **Any group whose data can't be read shows an explicit "not exposed" state — never a
      guessed or extrapolated number.** That honesty rule is non-negotiable.

- [ ] **B3 — agy quota.** Depends on A2. agy carries **more than one pool per account** —
      Gemini models in one, Claude/GPT models in another, each with independent weekly and
      5-hour windows (OmniLink `SPEC.md` §8.6.2, confirmed from live output). The data model
      in B1 must handle that from the start.

- [ ] **B4 — Offer B1+B2 upstream.** Small, obviously useful, consumes events they already
      emit, touches nothing architectural. They say big features won't be accepted, but this
      isn't one. If it lands you stop maintaining it forever.

---

## Stage C — the rest, in rough priority order

**C1 removed — upstream already ships the honest context-window meter.**
`ContextWindowMeter.tsx` is fed by `deriveLatestContextWindowSnapshot`, which reads the latest
`context-window.updated` activity rather than cumulative history. Server ingestion creates that
activity from canonical `thread.token-usage.updated` runtime events. Codex emits those events from
native `thread/tokenUsage/updated` notifications (`last.totalTokens` for current-window use and
`modelContextWindow` for the limit); Claude emits the same canonical event from SDK stream/result
usage and `getContextUsage()` snapshots. The 2026-08-15 real Codex product probe confirmed this
path live end-to-end, including the projected `23,942 / 258,400` snapshot. Claude's code path is
covered by focused adapter/ingestion tests, but a real Claude source turn remains blocked by the
S1 authentication prerequisite above.

- [ ] **C2 — Limit detection and hold.** Builds on Stage B. When a window is exhausted:
      latch the thread to a `rate-limited` state that later redraws can't flip back to
      "working", hold queued messages rather than firing them into a dead session, and show
      a banner naming the window and its reset time. **No automatic account rotation** —
      notify and pause (OmniLink `SPEC.md` §5.4, §8.9).
      Rule from OmniLink's parser work: 90% used is _not_ limited; ≥100% or an explicit
      limit signal is.

- [ ] **C3 — Slash-command catalogue, fully featured.** Upstream carries
      `ServerProviderSlashCommand { name, description?, input? }`
      (`packages/contracts/src/server.ts:81`) — whatever the provider reports, name and blurb.
      Enrich it: exact syntax, argument help, side effects, whether it interrupts work,
      where its output appears, and a minimum verified CLI version with an explicit
      "not supported by this installed version" state. OmniLink verified 39 commands from
      provider-owned sources (Claude's official reference, Codex's `rust-v0.145.0` source,
      agy's documented text) — that research carries over intact.
      Only ever show the active provider's real commands. Never guess.

- [ ] **C4 — Fork and handoff.** Lower priority, and worth re-checking after S2 — upstream's
      thread creation plus compatible-account continuation may already cover most of it.
      What's genuinely missing (OmniLink `SPEC.md` §8.5b): a deterministic, no-AI, no-network
      `HANDOFF.md` composed from the source thread and written into the checkout; the new
      thread opened with that brief sitting **unsent** in its composer so no provider turn is
      spent; and lineage visible in both directions in the header.
      The detail that makes it good: the target picker lists **quota groups with live
      remaining %**, not provider names — you choose by looking, not remembering. Needs B2.

- [ ] **C5 — Windows binary probing.** _What this is:_ when the app looks for `claude`,
      `codex` or `agy`, it currently trusts that a file existing means the CLI works. On
      Windows that's wrong often enough to matter — a Microsoft Store stub or an
      ACL-blocked packaged-app resource looks installed and isn't, and the app then reports
      a confusing failure instead of using the real CLI further down your `PATH`.
      The fix (OmniLink `SPEC.md` §2.2): actually run `--version` to prove a candidate works,
      keep looking past blocked candidates, honour `PATHEXT`, and put the verified binary
      first on the spawned process's `PATH`. Small, and it prevents a class of
      "why can't it find agy" mysteries. Good upstream candidate.

- [ ] **C6 — Your theme.** OmniLink `SPEC.md` Phase 5, nearly free here: upstream has a
      theme token layer plus VS Code theme import and OpenVSX. A restrained dark theme is a
      data change, not surgery. Do this last, or whenever you feel like it — it must never
      block anything above.

---

## Not doing

Decided, with reasons. Don't relitigate without a new fact.

- **PWA / installable web client.** You're using the upstream mobile app. It's free from
  the stores, it's good, and it talks to this fork's server. A PWA would duplicate it.
- **Permission rule engine** (glob/regex/exact rules, learned approvals, hard deny-list).
  Upstream's four modes are enough for Claude and Codex. agy gets targeted guardrails in
  A2 instead. OmniLink's own `SPEC.md` §9.5 conceded a PTY parser was never a real wall
  anyway; headless providers under their own native sandboxes are closer to actual
  containment than that ever was.
- **Non-AI chat titles.** Upstream's generated titles are better and cost is trivial.
- **Removing or hiding upstream features** — the PR client, SSH environments, cloud/T3
  Connect, the mobile app. All excluded by OmniLink `SPEC.md` §1.1; all shipped upstream.
  Ignoring them is free. Removing them is a permanent merge tax.
- **Anything from `server/src/transcripts/`, `server/src/pty/` or `server/src/permissions/`
  in the OmniLink repo.** Read them for findings; don't port them. See
  `omni/CONVERSION.md` §2.

---

## Housekeeping

- [ ] **H1 — Audit OmniLink's git history for chat data, then archive it.**
      `Titanspark21/omnilink` tracks `.mobile-pwa-data/*.db-wal` and `*.db-shm` runtime
      database journals (its `PLAN.md` P2-12). Determine whether history contains real
      chat or credential data **before** archiving or making anything public. Keep
      `SPEC.md` and `T3CODE-MIGRATION.md` — they're the requirements behind this fork.

- [ ] **H2 — Delete `Titanspark21/t3code`** (the old fork-of-a-fork) once you've confirmed
      `omni/salvage/` has everything you want. It shares no git history with upstream and
      can never cleanly merge — see `omni/CONVERSION.md` §3.
