# T3 Code

T3 Code is a multi-surface GUI for running coding agents through a local or remote T3 server. The
fork supports web, Electron desktop, and React Native mobile clients, with provider instances for
Codex, Claude, Cursor, Grok, OpenCode, and Antigravity.

## Current product behavior

- Provider sessions use the provider-native adapter protocol. Antigravity uses Google's ACP server
  for authentication, model discovery, permissions, turns, and session resume.
- Provider instances are isolated by instance ID, including Antigravity profiles and quota state.
- The web and desktop clients show subscription limits in the AGY limits section when Antigravity
  publishes Gemini and Claude/GPT windows. Quota refresh is read-only and does not start a coding
  turn.
- Quota data is kept separate from thread state, keyed by provider instance, and refreshed on a
  background loop or by an explicit refresh action.
- Desktop installers are built locally for Linux AppImage and Windows NSIS targets.

## Important boundaries

Remote connections must remain single-origin in development and must not bake localhost origins
into the client bundle. Provider and quota data crossing the server/client boundary uses the typed
contracts package. The server must never be run against the live `~/.t3/userdata` database during
development or verification.
