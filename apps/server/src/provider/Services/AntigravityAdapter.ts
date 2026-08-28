/**
 * AntigravityAdapter — per-instance adapter shape for the Antigravity ACP
 * bridge. The driver owns the concrete closure; this file only names its
 * error channel for the provider SPI.
 *
 * @module AntigravityAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface AntigravityAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
