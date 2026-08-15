# OmniCode Windows toolchain gate

Last verified: 2026-08-15

This file records the Stage 0 source/toolchain facts that are expensive to rediscover. It is not a replacement for the repo's normal build instructions.

## Vite+ licence and baseline

Vite+ is acceptable as this fork's repo-level toolchain baseline. The current upstream position is unambiguous:

- The Vite+ homepage says it is free and open source under the MIT license: https://viteplus.dev/
- VoidZero's 2026-03-13 Alpha announcement says Vite+ was open-sourced under MIT: https://voidzero.dev/posts/announcing-vite-plus-alpha
- The upstream repository is public at https://github.com/voidzero-dev/vite-plus and carries the MIT licence.

The older 2025 source-available/commercial posture is therefore historical and must not be used as the current licensing assumption. Re-check the primary sources if Vite+ changes licence again.

The Windows checkout verified here uses the repo's Vite+ task graph directly; no Turborepo config remains in the checkout. `vp --version` reported:

- `vp v0.2.9`
- repo-local Vite+ `v0.2.2`
- Node.js `24.19.0`
- pnpm `11.10.0`

For this Windows machine, dependency installation remains:

```text
vp i --filter=!@t3tools/mobile
```

The mobile exclusion is intentional and is explained in `omni/PLAN.md` S1.

## Source-run proof

From the isolated Windows worktree:

```text
npm run dev -- --dry-run
npm run dev -- --auto-bootstrap-project-from-cwd
```

The dry run resolved isolated worktree state and deterministic ports. The real run completed migrations, started the backend on `127.0.0.1:14710`, and served the Vite+ web client on `localhost:6670`. The probe was deliberately terminated after 60 seconds because the dev server is long-running; it remained live until termination.

External telemetry flushes failed during that probe because their HTTP fetches could not complete. They did not stop the local backend or web server and are not evidence of a source-startup failure.

## Real provider gate

| Provider | Result                              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex    | **Passed**                          | Codex CLI `0.147.0` is authenticated with ChatGPT. A real direct connectivity diagnostic returned from `gpt-5.6-sol`, then a source T3 server probe dispatched the same kind of turn through `/api/orchestration/dispatch`. The product turn completed with the exact requested assistant text and the thread projection recorded a live `context-window.updated` activity containing `usedTokens: 23942`, `maxTokens: 258400`, and `compactsAutomatically: true`. |
| Claude   | **Blocked on local authentication** | Claude Code `2.1.233` is installed, but `claude auth status` reports `loggedIn: false` and `authMethod: none`. `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` are both unset. A real Claude product turn cannot truthfully be run until this Windows account is authenticated.                                                                                                                                                                                  |

S1 is therefore not fully green yet: source startup, licence, and Codex are proven; Claude authentication is the remaining human prerequisite. Do not replace that missing real turn with a mock or fixture.

## Context-window meter reconciliation

Do not add another context-window meter. Upstream already has the full live path:

1. Codex `thread/tokenUsage/updated` notifications are normalized by `CodexAdapter.ts` into canonical `thread.token-usage.updated` events. Current-window usage comes from the provider's `last.totalTokens`, while the limit comes from `modelContextWindow`.
2. Claude `ClaudeAdapter.ts` emits the same canonical runtime event from stream/result usage and SDK `getContextUsage()` snapshots, including compaction context when exposed.
3. `ProviderRuntimeIngestion.ts` projects canonical token-usage events into orchestration activities with `kind: "context-window.updated"`.
4. `apps/web/src/lib/contextWindow.ts` selects the latest such activity and derives used/remaining/percentage values.
5. `ChatComposer.tsx` passes that snapshot to `ContextWindowMeter.tsx`.

The real Codex product probe on 2026-08-15 confirmed steps 1-5 are not merely test wiring: a real provider turn produced the live projected context snapshot. Keep the canonical upstream meter files intact unless a future bug is demonstrated.
