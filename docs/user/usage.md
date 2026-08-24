# Review usage

The Usage page combines Codex and Claude Code activity from your connected environments. It reads
the providers' local session history and shows API-equivalent token cost, processed tokens, cache
savings, provider shares, and model breakdowns. Subscription billing is separate from the raw token
cost shown here.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.

The account-limit indicators in the sidebar and provider picker are separate from token-cost
history. Codex can restore its last reported windows from local session history when T3 Code starts.
Claude reports its full 5-hour, weekly, and model-specific windows after a Claude session connects;
until then, the account correctly shows that no limit data has been reported yet.
