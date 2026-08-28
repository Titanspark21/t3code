# Theme architecture

Theme definitions live in [`packages/shared/src/themePalettes.ts`](../../packages/shared/src/themePalettes.ts).
That shared registry is the source of truth for web, desktop, and mobile; a new built-in theme must
have both an id in `BUILT_IN_THEME_IDS` and a `ThemeDefinition` in `BUILT_IN_THEMES`.

Each definition supplies the semantic `THEME_COLOR_ROLES` used by the web CSS adapter. The same
roles are translated into React Native variables and the mobile terminal palette. Theme previews use
the shared canvas, accent, and message-action roles, so a theme cannot look correct in the settings
card while using unrelated runtime colors.

Built-ins can be light-first or dark-first. The active `appearance` supplies the base colors and an
optional `variants` entry supplies the other mode. OmniCode is dark-first and includes a light
companion so system appearance never silently falls back to an unrelated palette.

Keep new built-ins fully literal and canonical in OKLCH. The web palette tests validate serialization,
and the mobile tests validate that every built-in can produce the complete native variable set with
readable placeholder, message, and code surfaces.
