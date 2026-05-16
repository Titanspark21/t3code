import { defineConfig } from "tsdown";

const internalPackagePrefixes = [
  "@t3tools/",
  "effect-acp",
  "effect-codex-app-server",
  "@github/copilot",
  "vscode-jsonrpc",
  "@anthropic-ai/claude-agent-sdk",
  "@opencode-ai/",
];

export default defineConfig({
  entry: ["src/bin.ts"],
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: (id) => internalPackagePrefixes.some((prefix) => id.startsWith(prefix)),
  inlineOnly: false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
