// @effect-diagnostics nodeBuiltinImport:off - expectations must follow the host path flavour.
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  buildAntigravityAcpSpawnInput,
  resolveAntigravityAcpModelId,
} from "./AntigravityAcpSupport.ts";

const settings = {
  binaryPath: "agy",
  bridgeCommand: "npx",
  bridgeArgs: ["-y", "agy-acp"],
  profileDir: "/profiles/gemini-1",
};

const environment: NodeJS.ProcessEnv = {
  HOME: "/home/real",
  USERPROFILE: "C:\\Users\\real",
  PATH: "/usr/bin",
};

describe("buildAntigravityAcpSpawnInput", () => {
  it("spawns the configured bridge with its arguments", () => {
    const result = buildAntigravityAcpSpawnInput(settings, "/work/project", environment);
    expect(result.spawn.command).toBe("npx");
    expect(result.spawn.args).toEqual(["-y", "agy-acp"]);
    expect(result.spawn.cwd).toBe("/work/project");
    expect(result.removedFlags).toEqual([]);
  });

  it("runs the bridge under this instance's isolated profile", () => {
    const result = buildAntigravityAcpSpawnInput(settings, "/work/project", environment);
    const env = result.spawn.env ?? {};
    // One of the two home variables must point at the profile, and git identity
    // must still resolve to the real user.
    expect([env["HOME"], env["USERPROFILE"]]).toContain(NodePath.resolve("/profiles/gemini-1"));
    expect(env["GIT_CONFIG_GLOBAL"]).toBe(NodePath.join("/home/real", ".gitconfig"));
  });

  it("pins the bridge to the configured agy binary", () => {
    const result = buildAntigravityAcpSpawnInput(
      { ...settings, binaryPath: "/opt/agy/bin/agy" },
      "/work/project",
      environment,
    );
    expect(result.spawn.env?.["AGY_BINARY"]).toBe("/opt/agy/bin/agy");
  });

  it("passes the selected model and safe runtime mode to the built-in bridge", () => {
    const result = buildAntigravityAcpSpawnInput(settings, "/work/project", environment, {
      model: "gemini-3.7-flash-medium",
      runtimeMode: "full-access",
    });
    expect(result.spawn.env?.["AGY_MODEL"]).toBe("gemini-3.7-flash-medium");
    expect(result.spawn.env?.["AGY_MODE"]).toBe("accept-edits");
  });

  it("strips a permission bypass pasted into the bridge arguments", () => {
    // The guardrail must survive user-editable settings, or it is not a guarantee.
    const result = buildAntigravityAcpSpawnInput(
      { ...settings, bridgeArgs: ["-y", "agy-acp", "--dangerously-skip-permissions"] },
      "/work/project",
      environment,
    );
    expect(result.spawn.args).toEqual(["-y", "agy-acp"]);
    expect(result.removedFlags).toEqual(["--dangerously-skip-permissions"]);
  });

  it("uses the built-in bridge when no bridge is configured", () => {
    const result = buildAntigravityAcpSpawnInput(
      { ...settings, bridgeCommand: "   " },
      "/work/project",
      environment,
    );
    expect(result.spawn.command).toBe(process.execPath);
    expect(result.spawn.args.at(-1)).toBe("antigravity-acp-bridge");
  });
});

describe("resolveAntigravityAcpModelId", () => {
  it("passes the exact id through, since agy resolves by printed id", () => {
    expect(resolveAntigravityAcpModelId("gemini-3.5-flash-high")).toBe("gemini-3.5-flash-high");
  });

  it("joins the separate effort selector back onto the CLI model id", () => {
    expect(resolveAntigravityAcpModelId("gemini-3.8-flash", "medium")).toBe(
      "gemini-3.8-flash-medium",
    );
    expect(resolveAntigravityAcpModelId("gemini-3.8-flash-high", "low")).toBe(
      "gemini-3.8-flash-high",
    );
  });

  it("ignores unsupported stored effort values", () => {
    expect(resolveAntigravityAcpModelId("gemini-3.8-flash", "maximum")).toBe("gemini-3.8-flash");
  });

  it("treats blank and missing as no selection", () => {
    expect(resolveAntigravityAcpModelId("  ")).toBeUndefined();
    expect(resolveAntigravityAcpModelId(null)).toBeUndefined();
    expect(resolveAntigravityAcpModelId(undefined)).toBeUndefined();
  });
});
