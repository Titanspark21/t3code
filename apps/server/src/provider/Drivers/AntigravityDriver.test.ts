import { describe, expect, it } from "@effect/vitest";

import { ProviderDriverKind } from "@t3tools/contracts";

import { AntigravityDriver } from "./AntigravityDriver.ts";
import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";

describe("AntigravityDriver", () => {
  it("is registered as a multi-instance built-in driver", () => {
    expect(BUILT_IN_DRIVERS).toContain(AntigravityDriver);
    expect(AntigravityDriver.driverKind).toBe(ProviderDriverKind.make("antigravity"));
    expect(AntigravityDriver.metadata).toEqual({
      displayName: "Antigravity",
      supportsMultipleInstances: true,
    });
  });

  it("defaults to disabled until an ACP bridge is configured", () => {
    expect(AntigravityDriver.defaultConfig()).toMatchObject({
      enabled: false,
      binaryPath: "agy",
      profileDir: "",
      bridgeCommand: "",
      bridgeArgs: [],
      customModels: [],
    });
  });
});
