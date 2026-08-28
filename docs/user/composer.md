# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

On servers that support direct uploads, images upload as soon as you add them. The send button
becomes available after every upload finishes. Failed uploads can be retried or removed.

On web and desktop, HEIC and HEIF photos are automatically converted to JPEG when you drag them into
the composer or paste them into a message.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

Provider commands are scoped to the provider selected in the composer. Where the provider exposes
the information, entries include exact argument syntax, side effects, behavior while work is active,
and the minimum verified CLI version. A command that requires a newer installed CLI remains visible
but disabled with the required version instead of failing after insertion.

## Attachments

Drag files onto the chat, paste them, or use the attachment picker. A message can include up to
eight attachments. GIF, JPEG, PNG, and WebP images are previewed and may be compressed to fit the
10 MB image limit. Other file types—including Markdown, office documents, archives, and source
files—can be attached up to 25 MB each. They are stored with the thread and made available to the
agent as local files. Whether an agent can interpret a particular format depends on its tools; for
example, an encrypted archive or proprietary document may need an appropriate reader.

## Sending while work is active

When you send while the agent is still working, T3 Code asks how to handle the message:

- **Steer now** delivers it immediately so the agent can adjust its current work.
- **Queue** keeps the draft and sends it automatically as a new turn when the current turn finishes.

Use the undo button beside an earlier user message to revert the workspace and provider
conversation to that checkpoint and place the message back in the composer for editing. Newer
messages and changes are discarded after confirmation.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.
