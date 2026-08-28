import { describe, expect, it } from "@effect/vitest";

import type * as EffectAcpSchema from "effect-acp/schema";

import { isAntigravityProjectTrustRequest } from "./AntigravityTrust.ts";

const makeRequest = (title: string): EffectAcpSchema.RequestPermissionRequest => ({
  sessionId: "session",
  options: [
    { kind: "allow_once", name: "Allow", optionId: "allow" },
    { kind: "reject_once", name: "Reject", optionId: "reject" },
  ],
  toolCall: { toolCallId: "request", title },
});

describe("isAntigravityProjectTrustRequest", () => {
  it("holds a project trust prompt for explicit user approval", () => {
    expect(
      isAntigravityProjectTrustRequest(makeRequest("Trust the contents of this project")),
    ).toBe(true);
  });

  it("does not classify ordinary command permissions as trust prompts", () => {
    expect(isAntigravityProjectTrustRequest(makeRequest("Run npm test in the workspace"))).toBe(
      false,
    );
  });
});
