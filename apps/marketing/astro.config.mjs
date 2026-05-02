import { defineConfig } from "astro/config";

export default defineConfig({
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
  // Workaround: Astro 6.2.1's `astro:dev-toolbar` plugin registers an esbuild
  // plugin via `optimizeDeps.esbuildOptions` whose `onEnd` callback reads
  // `result.metafile`. Vite 8.0.10's Rolldown-based esbuild compatibility shim
  // proxies that result and throws "Not implemented" on any property access,
  // crashing dep prebundling (and `astro check`). Setting `disabled: true`
  // bypasses the optimizer entirely; this is a static marketing site with no
  // client deps that benefit from prebundling. Vite warns that `disabled` is
  // deprecated and suggests `noDiscovery: true` + empty `include`, but astro's
  // dev-toolbar plugin force-injects entries into `include`, so noDiscovery is
  // not sufficient. Remove this once vite/rolldown shims `metafile` (or astro
  // migrates the dev-toolbar plugin to `rolldownOptions`).
  vite: {
    optimizeDeps: {
      disabled: true,
    },
  },
});
