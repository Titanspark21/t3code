import { describe, expect, it } from "@effect/vitest";

import { parseAntigravityAccountEmail } from "./AntigravityAccount.ts";

const LOG_LINE = (email: string) =>
  `ERROR: logging before google.Init: I0831 11:05:57.740726 1 server_oauth.go:190] applyAuthResult: email=${email}, authMethod=consumer, quotaProject=`;

describe("parseAntigravityAccountEmail", () => {
  it("reads the account the CLI reported", () => {
    expect(parseAntigravityAccountEmail(LOG_LINE("someone@example.com"))).toBe(
      "someone@example.com",
    );
  });

  it("prefers the most recent login in a log that spans a switch", () => {
    const log = [
      LOG_LINE("first@example.com"),
      "some other line",
      LOG_LINE("second@example.com"),
    ].join("\n");
    expect(parseAntigravityAccountEmail(log)).toBe("second@example.com");
  });

  it("reports nothing rather than guessing", () => {
    expect(parseAntigravityAccountEmail("")).toBeUndefined();
    expect(parseAntigravityAccountEmail("You are not logged into Antigravity.")).toBeUndefined();
    expect(
      parseAntigravityAccountEmail("applyAuthResult: email=, authMethod=none"),
    ).toBeUndefined();
  });
});
