import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import type { CursorSettings } from "@t3tools/contracts";
import { CursorSettings as CursorSettingsSchema } from "@t3tools/contracts";

import type { CursorSdkClient, CursorSdkModelListItem } from "../cursor/CursorSdkClient.ts";
import {
  buildCursorCapabilitiesFromSdkModel,
  buildCursorDiscoveredModelsFromSdkModels,
} from "../cursor/CursorSdkMappings.ts";
import { checkCursorProviderStatus, getCursorFallbackModels } from "./CursorProvider.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettingsSchema);

function runEffect<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

function makeSettings(input?: Partial<CursorSettings>): CursorSettings {
  return decodeCursorSettings({
    enabled: true,
    ...input,
  });
}

function makeSdkClient(input?: {
  readonly userError?: unknown;
  readonly modelError?: unknown;
  readonly models?: ReadonlyArray<CursorSdkModelListItem>;
}): CursorSdkClient {
  return {
    createAgent: vi.fn(),
    resumeAgent: vi.fn(),
    prompt: vi.fn(),
    getCurrentUser: vi.fn(async () => {
      if (input?.userError) {
        throw input.userError;
      }
      return {
        apiKeyName: "Personal key",
        userEmail: "cursor@example.com",
        userFirstName: "Cursor",
        userLastName: "User",
        createdAt: "2026-05-24T00:00:00.000Z",
      };
    }),
    listModels: vi.fn(async () => {
      if (input?.modelError) {
        throw input.modelError;
      }
      return input?.models ?? [];
    }),
  };
}

describe("CursorProvider SDK", () => {
  it("keeps fallback and custom models available", () => {
    const models = getCursorFallbackModels(makeSettings({ customModels: ["local-custom"] }));
    expect(models.map((model) => model.slug)).toEqual(["composer-2.5", "local-custom"]);
    expect(models[1]?.isCustom).toBe(true);
  });

  it("maps Cursor SDK model parameters into provider option descriptors", () => {
    const caps = buildCursorCapabilitiesFromSdkModel({
      id: "composer-2.5",
      displayName: "Composer 2.5",
      parameters: [
        {
          id: "effort",
          displayName: "Effort",
          values: [
            { value: "low", displayName: "Low" },
            { value: "high", displayName: "High" },
          ],
        },
        {
          id: "context",
          displayName: "Context",
          values: [{ value: "272k" }, { value: "1m" }],
        },
        {
          id: "fast",
          displayName: "Fast",
          values: [{ value: "false" }, { value: "true" }],
        },
      ],
      variants: [
        {
          displayName: "Default",
          isDefault: true,
          params: [
            { id: "effort", value: "high" },
            { id: "context", value: "272k" },
            { id: "fast", value: "false" },
          ],
        },
      ],
    });

    expect(caps.optionDescriptors).toEqual([
      {
        id: "reasoning",
        label: "Effort",
        type: "select",
        currentValue: "high",
        options: [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
      {
        id: "contextWindow",
        label: "Context",
        type: "select",
        currentValue: "272k",
        options: [
          { id: "272k", label: "272k", isDefault: true },
          { id: "1m", label: "1m" },
        ],
      },
      {
        id: "fastMode",
        label: "Fast",
        type: "boolean",
        currentValue: false,
      },
    ]);
  });

  it("builds discovered provider models from the SDK catalog", () => {
    const models = buildCursorDiscoveredModelsFromSdkModels(
      [
        {
          id: "composer-2.5",
          displayName: "Composer 2.5",
          parameters: [],
        },
      ],
      ["custom-cursor"],
    );
    expect(models.map((model) => [model.slug, model.name, model.isCustom])).toEqual([
      ["composer-2.5", "Composer 2.5", false],
      ["custom-cursor", "custom-cursor", true],
    ]);
  });

  it("reports missing CURSOR_API_KEY as unauthenticated", async () => {
    const snapshot = await runEffect(
      checkCursorProviderStatus(makeSettings(), {} as NodeJS.ProcessEnv, makeSdkClient()),
    );
    expect(snapshot.status).toBe("error");
    expect(snapshot.auth.status).toBe("unauthenticated");
    expect(snapshot.message).toContain("CURSOR_API_KEY");
  });

  it("authenticates and discovers models through the Cursor SDK", async () => {
    const sdkClient = makeSdkClient({
      models: [
        {
          id: "composer-2.5",
          displayName: "Composer 2.5",
          parameters: [],
        },
      ],
    });
    const snapshot = await runEffect(
      checkCursorProviderStatus(
        makeSettings(),
        { CURSOR_API_KEY: "cursor-key" } as NodeJS.ProcessEnv,
        sdkClient,
      ),
    );
    expect(snapshot.status).toBe("ready");
    expect(snapshot.auth).toMatchObject({
      status: "authenticated",
      email: "cursor@example.com",
      label: "Personal key - Cursor - User",
    });
    expect(snapshot.models.map((model) => model.slug)).toEqual(["composer-2.5"]);
  });

  it("keeps the provider usable when SDK model discovery fails", async () => {
    const snapshot = await runEffect(
      checkCursorProviderStatus(
        makeSettings(),
        { CURSOR_API_KEY: "cursor-key" } as NodeJS.ProcessEnv,
        makeSdkClient({ modelError: new Error("catalog down") }),
      ),
    );
    expect(snapshot.status).toBe("warning");
    expect(snapshot.auth.status).toBe("authenticated");
    expect(snapshot.message).toContain("catalog down");
    expect(snapshot.models.map((model) => model.slug)).toContain("composer-2.5");
  });
});
