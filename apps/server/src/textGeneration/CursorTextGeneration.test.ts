import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import { CursorSettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import type {
  CursorSdkAgentOptions,
  CursorSdkClient,
  CursorSdkRunResult,
} from "../provider/cursor/CursorSdkClient.ts";
import { makeCursorTextGeneration } from "./CursorTextGeneration.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettings);

function makeSdkClient(result: CursorSdkRunResult): CursorSdkClient {
  return {
    createAgent: vi.fn(),
    resumeAgent: vi.fn(),
    listModels: vi.fn(),
    getCurrentUser: vi.fn(),
    prompt: vi.fn(async (_message: string, _options?: CursorSdkAgentOptions) => result),
  };
}

function runEffect<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

describe("CursorTextGeneration SDK", () => {
  it("generates commit messages through Agent.prompt with SDK model params", async () => {
    const sdkClient = makeSdkClient({
      id: "prompt-run",
      status: "finished",
      result: JSON.stringify({
        subject: "Add generated commit message",
        body: "- verify cursor sdk text generation",
      }),
    });
    const textGeneration = await runEffect(
      makeCursorTextGeneration(
        decodeCursorSettings({ enabled: true }),
        { CURSOR_API_KEY: "cursor-key" } as NodeJS.ProcessEnv,
        { sdkClient },
      ),
    );

    const generated = await runEffect(
      textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: "feature/cursor-text-generation",
        stagedSummary: "M apps/server/src/textGeneration/CursorTextGeneration.ts",
        stagedPatch:
          "diff --git a/apps/server/src/textGeneration/CursorTextGeneration.ts b/apps/server/src/textGeneration/CursorTextGeneration.ts",
        modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "composer", [
          { id: "reasoning", value: "xhigh" },
          { id: "fastMode", value: true },
          { id: "contextWindow", value: "1m" },
        ]),
      }),
    );

    expect(generated).toEqual({
      subject: "Add generated commit message",
      body: "- verify cursor sdk text generation",
    });
    expect(sdkClient.prompt).toHaveBeenCalledWith(
      expect.stringContaining("feature/cursor-text-generation"),
      {
        apiKey: "cursor-key",
        local: {
          cwd: process.cwd(),
          settingSources: ["all"],
        },
        model: {
          id: "composer-2.5",
          params: [
            { id: "effort", value: "xhigh" },
            { id: "fast", value: "true" },
            { id: "context", value: "1m" },
          ],
        },
      },
    );
  });

  it("extracts structured output from noisy SDK text", async () => {
    const sdkClient = makeSdkClient({
      id: "prompt-run",
      status: "finished",
      result: [
        "Sure.",
        JSON.stringify({
          title: "Add Cursor SDK support",
          body: "- remove ACP path",
        }),
        "Done.",
      ].join("\n"),
    });
    const textGeneration = await runEffect(
      makeCursorTextGeneration(
        decodeCursorSettings({ enabled: true }),
        { CURSOR_API_KEY: "cursor-key" } as NodeJS.ProcessEnv,
        { sdkClient },
      ),
    );

    const generated = await runEffect(
      textGeneration.generatePrContent({
        cwd: process.cwd(),
        baseBranch: "main",
        headBranch: "cursor-sdk",
        commitSummary: "1 commit",
        diffSummary: "Cursor adapter update",
        diffPatch: "diff --git a/file b/file",
        modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "composer-2.5"),
      }),
    );

    expect(generated).toEqual({
      title: "Add Cursor SDK support",
      body: "- remove ACP path",
    });
  });

  it("generates thread titles", async () => {
    const sdkClient = makeSdkClient({
      id: "prompt-run",
      status: "finished",
      result: JSON.stringify({ title: "Cursor SDK migration" }),
    });
    const textGeneration = await runEffect(
      makeCursorTextGeneration(
        decodeCursorSettings({ enabled: true }),
        { CURSOR_API_KEY: "cursor-key" } as NodeJS.ProcessEnv,
        { sdkClient },
      ),
    );

    const generated = await runEffect(
      textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: "Move Cursor implementation to SDK",
        attachments: [],
        modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "composer-2.5"),
      }),
    );

    expect(generated.title).toBe("Cursor SDK migration");
  });

  it("requires CURSOR_API_KEY", async () => {
    const textGeneration = await runEffect(
      makeCursorTextGeneration(decodeCursorSettings({ enabled: true }), {} as NodeJS.ProcessEnv, {
        sdkClient: makeSdkClient({ id: "prompt-run", status: "finished" }),
      }),
    );

    await expect(
      runEffect(
        textGeneration.generateBranchName({
          cwd: process.cwd(),
          message: "missing key",
          attachments: [],
          modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "composer-2.5"),
        }),
      ),
    ).rejects.toThrow("CURSOR_API_KEY");
  });
});
