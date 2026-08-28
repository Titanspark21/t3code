# Fork a thread with a handoff

Forking a thread creates a new conversation with the current work written to `HANDOFF.md` in the
checkout. The brief is generated from the conversation and workspace details, without asking an
agent to summarize it.

Before the fork is created, choose a quota pool for the new conversation. Pools with fresh usage
information show their remaining percentage first. If a provider does not expose usage, or its
information is stale, that status is shown plainly instead of being treated as an estimate.

The new conversation opens with the handoff brief in the composer as an unsent draft. Review it and
send it when you are ready; choosing a target does not start an agent turn. The original and new
threads link to each other in their headers so you can move between them later.
