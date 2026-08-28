# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.

The account-limit indicators in the sidebar and provider picker are separate from token-cost
history. Codex can restore its last reported windows from local session history when T3 Code starts.
Claude reports its full 5-hour, weekly, and model-specific windows after a Claude session connects;
until then, the account correctly shows that no limit data has been reported yet.
When the same named account is connected from multiple devices, the sidebar combines those entries
into one account row and keeps the newest reported snapshot. Use the refresh button in the Limits
header to re-check connected providers and refresh their reported limits.

If a provider rejects a turn because its usage window is exhausted, the thread is marked **Rate
Limited** instead of being left in a generic unrecoverable error. Wait for the provider's reset
window, then send a new message in the same thread; T3 Code clears the temporary latch and resumes
the provider session. The web, desktop, and mobile thread views all show this recovery path.
