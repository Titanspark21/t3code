import { describe, expect, it } from "vite-plus/test";

import { enrichClaudeSlashCommands } from "./ClaudeProvider.ts";

describe("enrichClaudeSlashCommands", () => {
  it("adds verified behavior metadata to commands reported by the active session", () => {
    const commands = enrichClaudeSlashCommands(
      [{ name: "compact", description: "Provider description" }],
      "2.1.233",
    );

    expect(commands).toEqual([
      expect.objectContaining({
        name: "compact",
        description: "Provider description",
        syntax: "/compact [instructions]",
        duringWork: "queued",
        output: "conversation",
        minimumVersion: "2.1.0",
        support: "supported",
      }),
    ]);
  });

  it("shows newer commands as explicitly unsupported on an older installed CLI", () => {
    const commands = enrichClaudeSlashCommands([], "2.1.100");

    expect(commands.map((command) => command.name).sort()).toEqual(["effort", "skills"]);
    expect(commands.every((command) => command.support === "unsupported")).toBe(true);
    expect(commands.find((command) => command.name === "effort")?.supportNote).toContain(
      "Requires Claude Code 2.1.205",
    );
  });

  it("does not invent commands missing from a current provider session", () => {
    expect(enrichClaudeSlashCommands([], "2.1.233")).toEqual([]);
  });
});
