# OmniCode — fork notes and merge discipline

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT), started
clean from upstream `main` at `184d8ef33`. It replaces
[OmniLink](https://github.com/Titanspark21/omnilink).

- **Why this exists and what was decided:** `omni/CONVERSION.md`
- **What to build next:** `omni/PLAN.md`
- **Salvaged from the previous fork-of-a-fork:** `omni/salvage/`

Upstream is MIT and explicitly fork-friendly — their README says "If we ever go the wrong
direction, we want you to have everything you need to fork," and "a large number of our
users run forks." Taking updates is supported. Keeping it *cheap* is on you, and that's
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
```

**Merge, never rebase.** Rebasing a long-lived divergent branch replays every conflict on
every sync, forever. Merging resolves each one once.

---

## The rule that decides how painful this is

**Add files. Don't edit them.**

Every line you change in an existing upstream file is a conflict you will resolve again on
every future sync. Every new file is free. The architecture is unusually kind about this:

| Adding | Cost |
|---|---|
| A provider | New `Drivers/XDriver.ts` + `Layers/XAdapter.ts`, and **one line** in `builtInDrivers.ts`. Upstream's own docs: "No orchestration, contract, or client change is required for the common case." |
| A panel | New component + one registration line |
| A contract | **A new file** in `packages/contracts/src/` |

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

This *is* your merge checklist. Before each sync, it tells you exactly where to look.
If a change isn't in this table, it shouldn't exist.

| Upstream file | Change | Why | Task |
|---|---|---|---|
| _(none yet)_ | | | |

---

## Upstream what you can

Every patch they accept is one you stop carrying. Two good candidates in `omni/PLAN.md`:

- **B4** — the quota panel. It consumes `account.rate-limits.updated` events both adapters
  already emit and nothing currently reads. Small, useful, touches nothing architectural.
- **C5** — Windows binary probing. Proving a candidate CLI runs `--version` rather than
  trusting that a file exists.

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
