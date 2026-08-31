# Scheduled tasks

A scheduled task sends the same prompt to one or more provider accounts at a fixed time,
every day or on chosen weekdays. It exists for work you want to happen while nobody is
watching — most commonly opening a provider's rolling usage window first thing in the
morning on more than one account.

Open **Settings → Scheduled Tasks**. Each connected environment keeps its own list,
because the environment's machine is what runs the prompt.

For each task you choose:

- **Name** — what the run's thread is called.
- **Prompt** — the message sent at the scheduled time.
- **Project** — the workspace the run happens in.
- **Accounts and models** — one or more configured provider accounts, each with its own
  model. Running the same prompt on two accounts is the point: they are usually two
  different subscriptions.
- **Time and days** — the time is that environment's own clock, not your device's, so a
  task set to 05:00 fires at five in the morning where the server is. Selecting no days
  means every day.

## What a run looks like

Each target gets its own ordinary thread with real history, so you can open it, read the
answer and continue the conversation. As soon as the turn finishes, the thread settles
itself and drops out of the active list — a scheduled run does not pile up in your chats.

A run that needs you still surfaces. If the agent asks for an approval or input, the
thread un-settles and reappears the way any blocked thread does.

## Missed runs

If the machine is asleep or offline when a task was due, the run fires when the machine
comes back — but only within an hour of the scheduled time. Later than that it is
skipped until the next slot, because a prompt meant to open a five-hour window at 05:00
spends that window if it lands at lunchtime.

Use **Run now** in the task's row to fire a task immediately without touching its
schedule. **Last run** in the same row reports what happened, including targets that
failed to start.
