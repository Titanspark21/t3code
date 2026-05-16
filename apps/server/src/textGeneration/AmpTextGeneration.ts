/**
 * AmpTextGeneration — Graceful "not supported" text-generation shape for Amp.
 *
 * Amp's CLI does not currently expose a structured-output mode that maps
 * cleanly onto our `TextGenerationShape` contract (commit messages, PR
 * titles, branch names, thread titles). Rather than block the driver from
 * registering, this factory returns an implementation that fails every
 * operation with a clear `TextGenerationError`. The user can still pick a
 * different instance (Codex, Claude, OpenCode, …) for text generation
 * features, and the Amp instance remains usable for chat-style sessions.
 *
 * @module AmpTextGeneration
 */
import * as Effect from "effect/Effect";

import type { GenericProviderSettings } from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";

import { type TextGenerationShape } from "./TextGeneration.ts";

const NOT_SUPPORTED_DETAIL =
  "Amp does not expose a structured text-generation API. Use a different provider instance for commit/PR/branch/title generation.";

const fail = (
  operation:
    | "generateCommitMessage"
    | "generatePrContent"
    | "generateBranchName"
    | "generateThreadTitle",
) => Effect.fail(new TextGenerationError({ operation, detail: NOT_SUPPORTED_DETAIL }));

export const makeAmpTextGeneration = Effect.fn("makeAmpTextGeneration")(function* (
  _ampSettings: GenericProviderSettings,
  _environment: NodeJS.ProcessEnv = process.env,
) {
  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = () =>
    fail("generateCommitMessage");

  const generatePrContent: TextGenerationShape["generatePrContent"] = () =>
    fail("generatePrContent");

  const generateBranchName: TextGenerationShape["generateBranchName"] = () =>
    fail("generateBranchName");

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = () =>
    fail("generateThreadTitle");

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});
