import { describe, expect, it } from "vite-plus/test";

import { enrichAntigravitySlashCommands } from "./AntigravitySlashCommands.ts";

describe("enrichAntigravitySlashCommands", () => {
  it("exposes only the documented Antigravity commands with complete metadata", () => {
    const commands = enrichAntigravitySlashCommands("agy 1.1.7");

    expect(commands.map((command) => command.name)).toEqual([
      "help",
      "config",
      "settings",
      "model",
      "planning",
      "mcp",
      "quit",
    ]);
    expect(commands.every((command) => command.support === "supported")).toBe(true);
    expect(commands.every((command) => command.duringWork === "idle-only")).toBe(true);
    expect(commands.every((command) => command.output === "conversation")).toBe(true);
    expect(commands.find((command) => command.name === "model")).toMatchObject({
      syntax: "/model",
      sideEffects: "Changes the model for subsequent turns.",
      minimumVersion: "1.1.7",
    });
  });

  it("marks the complete catalogue unsupported below the verified CLI floor", () => {
    const commands = enrichAntigravitySlashCommands("1.1.6");

    expect(commands.every((command) => command.support === "unsupported")).toBe(true);
    expect(commands[0]?.supportNote).toContain("Requires Antigravity CLI 1.1.7");
  });

  it("keeps commands visible but unverified when the version cannot be read", () => {
    const commands = enrichAntigravitySlashCommands(null);

    expect(commands).not.toHaveLength(0);
    expect(commands.every((command) => command.support === "unknown")).toBe(true);
    expect(commands[0]?.supportNote).toContain("version could not be read");
  });
});
