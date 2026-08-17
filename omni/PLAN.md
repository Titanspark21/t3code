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

## Read this first — where the fork actually stands

Everything built so far is **server-side and unreferenced**. `apps/server/src/quota/*`,
`apps/server/src/provider/Drivers/Antigravity*` and `apps/server/src/provider/acp/
AntigravityAcpSupport.ts` compile, lint, and pass 76 tests — and nothing in the app imports
a single one of them. There is no driver registration, no event subscription, no wire
contract, no client state, no UI. **Running this fork today behaves exactly like upstream
t3code.**

That is not a criticism of the work; the pure cores are the hard part and they are done.
It does mean the next task in every stage is _wiring_, and until that lands there is
nothing to look at. Stages B and C below are ordered accordingly.

---

## Stage 0 — prove the ground before building on it

- [ ] **S1 — Toolchain and licence.** Substantially done; one gate remains.
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
        **This now blocks more than S1**: B2's Claude rows, B6's binding-window fix and the
        C2 reproduction all need a live authenticated Claude account to verify against.

- [ ] **S2 — Use it as-is for a week.** Real work, Claude and Codex, no changes.
      This is a task, not a suggestion. Half of Stage 2 may stop mattering once you've
      lived with the thing, and you'll find out which parts of OmniLink's spec you actually
      miss versus which you only think you miss.
      _Gate: a written list of what genuinely annoyed you, in priority order. Re-order the
      rest of this plan against it._

---

## Stage B — Usage limits, visible

Promoted above Stage A. It is the thing that gets used every day, it is closest to done,
and — unlike the agy work — nothing in it is blocked on a 1,200-line adapter.

### The upstream branch you must look at before writing any more of this

**`upstream/t3code/usage-limits-analytics`** (8 commits, 2026-08-08, unmerged, not in
`main`). It builds much of the same idea:

- `apps/server/src/usage/AccountLimitsService.ts` — one cached snapshot per provider, fed
  passively from `account.rate-limits.updated`
- `accountLimitsTranscripts.ts` — **seeds Codex limits from the `rate_limits` objects its
  transcripts already carry on disk**, so numbers survive a restart
- a `ClaudeAdapter.ts` change that pulls the **full** window set through a throttled SDK
  usage control request
- `server.getAccountLimits` RPC, wired through `ws.ts`, `rpc.ts`, `RpcAuthorization.ts`
- `apps/web/src/state/accountLimits.ts` — client state that merges across environments and
  keeps the freshest snapshot
- `AccountLimits.tsx` — a Limits strip on the Usage page **plus a hover card on the sidebar
  Usage button**, and `limitsFormat.ts` for the copy

**Its data model is wrong for this fork and its plumbing is right.** Upstream keys by
`UsageProviderKind` — the contract comment literally says "At most one snapshot per
provider". With Codex 1 + Codex 2 + Claude 1 + Claude 2 configured, that collapses four
accounts into two rows showing whichever account reported last. That is exactly the
confident-wrong-number failure `packages/contracts/src/quota.ts` exists to prevent, and
this fork's model — keyed by `ProviderInstanceId`, with multiple groups per account — is
the correct one.

- [ ] **B0 — Decide how to take that branch.** Before B1b.
      Read it, then pick one and write the decision into `omni/CONVERSION.md`:
      (a) cherry-pick it and re-key its service to `ProviderInstanceId`;
      (b) leave it alone and lift only the four findings below into fork-local files;
      (c) wait for it to land upstream and merge normally.
      Bias toward (b) — it keeps `OMNI.md`'s add-don't-edit rule intact — but (a) is
      defensible if the branch merges cleanly, because the RPC/auth/ws edits are exactly
      the upstream files this fork least wants to hand-modify.
      _Gate: a written decision, and B4 below updated to match._

### Built — cores only, wired to nothing

- [x] **Contracts** — `packages/contracts/src/quota.ts`. New file, keyed by
      `ProviderInstanceId`, multiple `QuotaGroup`s per account (so agy's several pools need
      no special case later), windows classified by published duration, and absence
      modelled as absence rather than zero.
- [x] **Normalizer** — `apps/server/src/quota/normalizeRateLimits.ts` + tests. Codex and
      Claude payloads folded into that shape; sparse updates merged onto the previous
      snapshot so a rolling `primary`-only message can't erase `secondary`; unknown drivers
      return `undefined` rather than guessing.
- [x] **Reducer** — `apps/server/src/quota/quotaReducer.ts` + tests. Applies events to a
      `ReadonlyMap<ProviderInstanceId, AccountQuotaSnapshot>`, returns the same object when
      nothing changed (so the sidebar doesn't repaint on every assistant delta), forgets an
      instance when it's removed, and `isRateLimited` already self-clears on staleness and
      on a reset time that has passed — the logic C2 needs.

### Left to do

- [ ] **B1b — Wire the reducer to the event stream and the wire.** The single highest-value
      task in this plan; everything visible depends on it. - subscribe at `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` —
      that is where runtime events already land, and it is the file upstream's branch
      touched for the same reason - hold the state in a fork-local service (`apps/server/src/quota/QuotaService.ts`),
      not inside an existing upstream service - expose it: an RPC returning the snapshot map, plus a push so the panel is live
      rather than polled - client state in `apps/web/src/state/quota.ts`, merging across environments the way
      `apps/web/src/state/accountLimits.ts` does on the upstream branch - **contracts only for mobile.** `apps/mobile/` stays untouched per `OMNI.md`; the
      panel is web + desktop. Say so in the PR body so it isn't read as an oversight.
      _Gate: real Codex and Claude figures land in the client, observed live, not in a test._

- [ ] **B2 — The panel. Bottom-left, always visible.**
      Mount inside `SidebarChromeFooter` in
      `apps/web/src/components/sidebar/SidebarChrome.tsx` — one import plus one JSX line, and
      both `Sidebar.tsx:3806` and `LegacySidebar.tsx:3700` already render that footer, so a
      single insertion covers both shells. Everything else goes in new files under
      `apps/web/src/components/quota/`.

      **Rows come from configured provider instances only** — decided. Add a third Codex
      account and a row appears; remove one and it goes. Display name and accent colour come
      from the instance config (OmniLink `SPEC.md` §7.5). Nothing is hard-coded, so
      "Codex 1, Codex 2, Claude 1, Claude 2" is what *your* setup renders, not what the code
      says.

      **The agy row is a single combined row.** It shows *average remaining* across all
      connected agy accounts; clicking expands it to the individual remaining figure per
      account. This is the one place the panel aggregates, because agy rotates between three
      signed-in accounts automatically and the per-account split is detail, not headline.
      _Design note, raised once and not overriding the decision:_ with automatic rotation the
      pool you actually get is the account with the **most** remaining, so an average
      understates what's available — consider showing "avg 41% · best 78%" in the collapsed
      row, and decide after seeing it on screen.

      **Honesty rules, non-negotiable.** A group whose data can't be read shows an explicit
      "not exposed" state. A snapshot past `QUOTA_SNAPSHOT_STALE_AFTER_MS` renders as stale
      with its age, never as a current figure. Never a guessed or extrapolated number.

      Reset countdowns on hover; click a row to refresh. Respect `AGENTS.md`: no
      continuously repainting animation — countdowns tick on a coarse interval, and the
      collapsed state must not re-render on unrelated sidebar traffic.

- [ ] **B5 — Hover detail in the provider/account selector.** New.
      Hovering a provider/account in the picker shows a popup with that account's 5-hour and
      weekly usage. Cover both entry points, per `AGENTS.md`'s hit-every-surface rule: - the composer picker — `apps/web/src/components/chat/ModelListRow.tsx` (142 lines) is
      the row; `ModelPickerContent.tsx` and `ProviderModelPicker.tsx` are its hosts - Settings → Providers — `apps/web/src/components/settings/ProviderInstanceCard.tsx`
      Reuse whatever B2 renders for a single account rather than writing second copy. The
      upstream branch's `limitsFormat.ts` is worth reading for the wording it settled on
      after two follow-up commits ("unambiguous limits copy", "reset text no longer wraps").
      Blocked on B1b.

- [ ] **B6 — Claude's streamed event only names the binding window.** New, and a real
      correctness gap.
      `normalizeClaudeRateLimits` parses defensively across several shapes, but the source
      event is the constraint: upstream's branch notes at `ClaudeAdapter.ts:3430` that the
      streamed `rate_limit_event` reports **only the window currently binding**. So a purely
      passive listener can populate 5-hour _or_ weekly, never reliably both — and B5
      explicitly promises both. The fix upstream chose is a throttled SDK usage control
      request pulling the full set (see `MIN_USAGE_CONTROL_INTERVAL`, `ClaudeAdapter.ts:106`).
      Decide with B0 whether to take their implementation or write a fork-local equivalent.
      _Gate: a Claude account showing 5-hour and weekly simultaneously, verified live._

- [ ] **B7 — Cold start.** New.
      An always-visible panel is empty on launch, because providers publish limits only as a
      side effect of doing work. Two different answers, and the panel must not pretend
      otherwise: - **Codex** — recoverable. Its transcripts carry `rate_limits` objects on disk;
      upstream's `accountLimitsTranscripts.ts` already reads them. Take or reimplement. - **Claude** — not recoverable. Limits never hit disk, so a fresh launch genuinely
      cannot know. The row must say "no data yet — send a message" rather than showing a
      blank bar that reads as 0% used.
      Blocked on B0.

- [ ] **B3 — agy quota.** Depends on A2. agy carries **more than one pool per account** —
      Gemini models in one, Claude/GPT models in another, each with independent weekly and
      5-hour windows (OmniLink `SPEC.md` §8.6.2, confirmed from live output). `QuotaGroup`
      already models this; the work is the agy-side normalizer plus deciding how the
      combined B2 row averages across _pools within_ an account as well as across accounts.

- [ ] **B4 — Revisit upstreaming after B0.** Rewritten: this task used to say "offer B1+B2
      upstream". Upstream has since built their own version on
      `t3code/usage-limits-analytics`, so the offer is no longer "here's a feature you don't
      have" — it's at most "your snapshot-per-provider model breaks with two accounts on one
      provider, here's the instance-keyed version". That is a smaller, better-targeted
      contribution and worth making _only after_ B1b and B2 prove it works here. If their
      branch lands first, sync and re-scope this to the keying fix alone.

---

## Stage C — the limit failure, and the rest

- [ ] **C2 — The unrecoverable chat. Reproduce it before fixing it.** Expanded — this is the
      bug you actually hit, and it is currently the fork's most user-visible defect.
      _Symptom, from the developer:_ hitting a usage limit produces an error and the thread
      is unrecoverable **even after the window has reset**. Restarting the thread is the only
      way out.
      _What's known:_ `apps/server/src/orchestration/` contains **zero** rate-limit handling
      today — grep confirms it — so this is upstream's generic turn-failure path, not
      anything the fork introduced. `isRateLimited` in `quotaReducer.ts` already implements
      the self-clearing half (stale snapshots and passed reset times both clear), but it is
      wired to nothing.
      **Diagnose before coding.** The fix differs entirely depending on which of these it is,
      and guessing has already cost time elsewhere: - a thread status latched to an error state that no later event clears; - a provider session that died and is never re-spawned, so every subsequent send goes
      into a dead process; - a queued message stuck in a non-retryable state; - the error surfacing as an unreadable raw provider dump with no recovery affordance.
      _Then build:_ latch a `rate-limited` state that later redraws can't flip back to
      "working"; hold queued messages rather than firing them into a dead session; show a
      banner naming the window and its reset time; and — the part that fixes the actual
      complaint — **an explicit way back**, either automatic on reset or a visible "resume"
      control, with a test that proves a thread recovers after the window rolls over.
      **No automatic account rotation** — notify and pause (OmniLink `SPEC.md` §5.4, §8.9).
      Rule from OmniLink's parser work: 90% used is _not_ limited; ≥100% or an explicit
      limit signal is.
      Needs B1b for the signal. Needs S1's Claude authentication to reproduce.

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

---

## Stage A — Antigravity (`agy`)

The one provider upstream doesn't have. Upstream ships five drivers registered in
`apps/server/src/provider/builtInDrivers.ts`; their docs say adding one needs "no
orchestration, contract, or client change."

**Everything below is unreachable until A2 lands.** The four built pieces are correct and
tested and cannot run, because nothing constructs them — there is no driver, and
`builtInDrivers.ts` has never been touched. Treat A2 as the gate for the whole stage.

### A1 — transport spike: ANSWERED

`agy` has **no native ACP**. There is an open upstream request for an `--acp` flag
([antigravity-cli#31](https://github.com/google-antigravity/antigravity-cli/issues/31)),
and several community adapters wrap the CLI today
([agy-acp](https://github.com/shindgew/agy-acp),
[antigravity-acp](https://github.com/shubzkothekar/antigravity-acp),
[agy-agent-acp](https://github.com/jameslunardi/agy-agent-acp)). Zed has a registry
discussion open for it too.

**Decision: speak ACP to a configurable bridge process.** Reasons:

- it reuses `packages/effect-acp` and `apps/server/src/provider/acp/AcpSessionRuntime.ts`
  wholesale, the same path Cursor and Grok already take
- streaming, tool calls, approvals and interrupts all work, unlike `agy --print`
- when Google ships `--acp`, the only change is the default: point `bridgeCommand` at
  `agy` with `--acp` in `bridgeArgs`. Nothing downstream moves

The bridge command is a setting with **no default**, deliberately: an unconfigured
instance reports "no ACP bridge configured" with the fix, rather than silently spawning
some package off the network.

### Built — cores only, wired to nothing

- [x] **Settings** — `packages/contracts/src/antigravity.ts`. New file, no edit to
      `settings.ts`: `providerInstances` treats driver config as opaque exactly so a fork
      can add a driver.
- [x] **Account isolation** — `AntigravityHome.ts` + tests. Windows moves `USERPROFILE`
      only and pins `HOME`/`APPDATA`/`LOCALAPPDATA`/`GIT_CONFIG_GLOBAL` back to the real
      user; POSIX must move `HOME` and pins git identity and the npm cache back, with the
      residual ssh redirection reported by `antigravityIsolationCaveats` instead of hidden.
      Fixes the previous fork's defect (both vars redirected, no passthrough).
- [x] **Launch mapping** — `AntigravityLaunch.ts` + tests. Never emits
      `--dangerously-skip-permissions`; `full-access` maps to `--mode accept-edits`, and
      bypass flags pasted into settings are stripped and reported. Models parsed from
      `agy models`.
- [x] **Health probe** — `Layers/AntigravityProvider.ts`. Runs `--version` and `agy models`
      under the isolated environment, so a profile that is not logged in reports as such
      instead of inheriting the default account's health.
- [x] **ACP support surface** — `acp/AntigravityAcpSupport.ts` + tests. Bridge spawn under
      the isolated profile, `AGY_BINARY` pinned so the bridge cannot resolve a different CLI
      than the health probe checked, bypass flags stripped from user-editable bridge
      arguments, and model selection passed through by exact id (agy bakes the reasoning
      tier into the id, so there is no separate effort axis).

### Left to do

- [ ] **A2 — the ACP adapter.** `Layers/AntigravityAdapter.ts`, modelled on
      `CursorAdapter.ts` (1,182 lines) with `AntigravityAcpSupport.ts` beside it like
      `GrokAcpSupport.ts` (108 lines). The shared `AcpSessionRuntime.ts` does the protocol;
      the adapter maps its events onto orchestration events.
      **Not attempted blind** — there is no generic adapter factory to parameterize, and
      ~1,200 lines written without a typechecker would not compile. Do this with `vp`
      running. Start by diffing `CursorAdapter.ts` against `GrokAdapter.ts` to see which
      parts are genuinely provider-specific.
      Must emit `account.rate-limits.updated` in a shape `normalizeRateLimits.ts` can parse,
      or B3 has nothing to normalize — add an agy branch to `normalizerFor` in the same pass.
- [ ] **A3 — driver + registration.** `Drivers/AntigravityDriver.ts` following
      `CursorDriver.ts`, then one line in `builtInDrivers.ts`. Blocked on A2, since the
      driver's `create` must return an adapter. **Until this line exists, none of the four
      built pieces above can ever execute.**
- [ ] **A4 — account presets** in the Add Provider dialog ("Antigravity 1/2/3", filling the
      profile dir), as the old fork had — see `omni/salvage/src/.../providerProfilePresets.ts`.
      Three presets, not two: the agy setup on this machine rotates three signed-in accounts.
- [ ] **A5 — first-run trust prompt.** A fresh agy session in a new project asks "Do you
      trust the contents of this project?". It must surface, never be auto-answered.

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
- **Building the quota panel for mobile.** `apps/mobile/` is off-limits per `OMNI.md`, and
  the mobile app you use is upstream's published build, which will never carry a fork-local
  panel. Contracts stay surface-neutral; the UI is web + desktop.

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
