# OmniCode — fork notes and merge discipline

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT), started
clean from upstream `main` at `184d8ef33`. It replaces
[OmniLink](https://github.com/Titanspark21/omnilink).

- **Why this exists and what was decided:** `omni/CONVERSION.md`
- **What to build next:** `omni/PLAN.md`
- **Salvaged from the previous fork-of-a-fork:** `omni/salvage/`
- **Local checkout:** `C:\MySoftware\t3code`

Upstream is MIT and explicitly fork-friendly — their README says "If we ever go the wrong
direction, we want you to have everything you need to fork," and "a large number of our
users run forks." Taking updates is supported. Keeping it _cheap_ is on you, and that's
what this file is for.

---

## Branch model

```
main        exact mirror of upstream/main. Never commit here.
omni/main   your work. Everything happens here.
```

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git

# weekly, on a fixed day — not "when something breaks"
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout omni/main && git merge main

# then reinstall — always with the mobile workspace excluded, see omni/PLAN.md S1
vp i --filter=!@t3tools/mobile
```

**Never plain `vp i` on this machine.** It fails with `ERR_PNPM_EPERM` unpacking Expo's
prebuilt native binaries, which Defender locks mid-copy. The flag skips the mobile
workspace, which you don't build anyway.

**Merge, never rebase.** Rebasing a long-lived divergent branch replays every conflict on
every sync, forever. Merging resolves each one once.

### You never need a pull request

Both branches are yours, and you sync them with `git merge` on the command line. There is
no PR anywhere in the workflow above.

After any push to `omni/main`, GitHub shows a yellow **"omni/main had recent pushes —
Compare & pull request"** banner. That is an offer, not a pull request; nothing has been
created. **Ignore it.**

It matters because on a fork GitHub defaults the _base_ of a new PR to the **parent repo**
— so clicking through and confirming would propose your entire fork to
`pingdotgg/t3code`, publicly, in front of their maintainers. Dismiss the banner with the
`×`. If you ever do want a PR against your own fork, change the base repo dropdown from
`pingdotgg/t3code` to `Titanspark21/t3code` first, and check it before submitting.

---

## The rule that decides how painful this is

**Add files. Don't edit them.**

Every line you change in an existing upstream file is a conflict you will resolve again on
every future sync. Every new file is free. The architecture is unusually kind about this:

| Adding     | Cost                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A provider | New `Drivers/XDriver.ts` + `Layers/XAdapter.ts`, and **one line** in `builtInDrivers.ts`. Upstream's own docs: "No orchestration, contract, or client change is required for the common case." |
| A panel    | New component + one registration line                                                                                                                                                          |
| A contract | **A new file** in `packages/contracts/src/`                                                                                                                                                    |

### Contracts are the sharpest edge

`packages/contracts` ripples into server, web, mobile and desktop simultaneously. Put
additions in new files — `packages/contracts/src/quota.ts` — never as edits to
`orchestration.ts` or `providerRuntime.ts`.

### Never touch

All high-churn, all pure conflict, none of it worth it:

- `pnpm-workspace.yaml` catalog versions
- root and workspace build/test/lint scripts
- `.github/workflows/`
- `infra/`
- `apps/mobile/` — unless you've decided to own a mobile build

### Keep the table below current

This _is_ your merge checklist. Before each sync, it tells you exactly where to look.
If a change isn't in this table, it shouldn't exist.

| Upstream file                                                      | Change                                                      | Why                                                             | Task |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------- | ---- |
| `packages/contracts/package.json`                                  | added `./quota` and `./antigravity` subpath exports         | so those modules resolve; both schemas live in new files        | B1   |
| `apps/server/src/provider/builtInDrivers.ts`                       | _(pending)_ one line registering `AntigravityDriver`        | adding a driver needs no other upstream edit                    | A3   |
| `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` | _(pending)_ subscribe the quota reducer to runtime events   | the only place `account.rate-limits.updated` already lands      | B1b  |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`                | _(pending)_ one line mounting the quota panel in the footer | both sidebar shells render this footer, so one edit covers both | B2   |

**Conflict warning on the last two.** Upstream's unmerged `t3code/usage-limits-analytics`
branch edits _both_ of those files for the same feature. If it lands, expect a real conflict
in each, not a textual one — resolve it by keeping this fork's `ProviderInstanceId` keying
and dropping theirs. See `omni/PLAN.md` B0.

---

## Upstream what you can

Every patch they accept is one you stop carrying. Candidates in `omni/PLAN.md`:

- **C5** — Windows binary probing. Proving a candidate CLI runs `--version` rather than
  trusting that a file exists. Still the cleanest offer: small, self-contained, and nobody
  upstream is working on it.
- **B4** — _rescoped._ The quota panel is no longer a gap they have; upstream built their
  own on `t3code/usage-limits-analytics` in August. What's left to offer is the narrower
  fix that their snapshot-per-provider keying breaks as soon as one provider has two
  accounts. Make that offer only after B1b and B2 prove the instance-keyed version works
  here.

They say big features won't be accepted. Neither of these is a big feature.

---

## Two things that will bite

**Everything server-side is Effect.** Effect/Schema contracts, an event-sourced engine,
Atom client state, and a vendored beta `effect-smol`. Upstream's `AGENTS.md` tells agents
to read `.repos/effect-smol/LLMS.md` before writing server code. Do that.

**The toolchain is Vite+ (`vp`), not plain pnpm.** `vp i`, `vp run dev`, `vp test run`,
`vp lint`. It needs a global binary (`irm https://vite.plus/ps1 | iex` on Windows) and it's
VoidZero's commercial product, not part of the MIT repo. Confirm its terms cover your use
before investing — that's task S1, deliberately first in the plan.
