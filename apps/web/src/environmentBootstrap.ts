import { createKnownEnvironment, type KnownEnvironment } from "@t3tools/client-runtime/environment";
import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";

function normalizeBaseUrl(rawValue: string): string {
  return new URL(rawValue, window.location.origin).toString();
}

function swapBaseUrlProtocol(
  rawValue: string,
  nextProtocol: "http:" | "https:" | "ws:" | "wss:",
): string {
  const url = new URL(normalizeBaseUrl(rawValue));
  url.protocol = nextProtocol;
  return url.toString();
}

function createKnownEnvironmentFromWsUrl(input: {
  readonly id: string;
  readonly label: string;
  readonly source: KnownEnvironment["source"];
  readonly wsUrl: string;
}): KnownEnvironment {
  const wsBaseUrl = normalizeBaseUrl(input.wsUrl);
  const httpBaseUrl = wsBaseUrl.startsWith("wss:")
    ? swapBaseUrlProtocol(wsBaseUrl, "https:")
    : swapBaseUrlProtocol(wsBaseUrl, "http:");

  return createKnownEnvironment({
    id: input.id,
    label: input.label,
    source: input.source,
    target: {
      httpBaseUrl,
      wsBaseUrl,
    },
  });
}

function createKnownEnvironmentFromDesktopBootstrap(
  bootstrap: DesktopEnvironmentBootstrap | null | undefined,
): KnownEnvironment | null {
  if (!bootstrap?.wsBaseUrl) {
    return null;
  }

  return createKnownEnvironmentFromWsUrl({
    id: `desktop:${bootstrap.label}`,
    label: bootstrap.label,
    source: "desktop-managed",
    wsUrl: bootstrap.wsBaseUrl,
  });
}

export function getPrimaryKnownEnvironment(): KnownEnvironment | null {
  const desktopEnvironment = createKnownEnvironmentFromDesktopBootstrap(
    window.desktopBridge?.getLocalEnvironmentBootstrap(),
  );
  if (desktopEnvironment) {
    return desktopEnvironment;
  }

  const configuredWsUrl = import.meta.env.VITE_WS_URL;
  if (typeof configuredWsUrl === "string" && configuredWsUrl.length > 0) {
    return createKnownEnvironmentFromWsUrl({
      id: "configured-primary",
      label: "Primary environment",
      source: "configured",
      wsUrl: configuredWsUrl,
    });
  }

  return createKnownEnvironmentFromWsUrl({
    id: "window-origin",
    label: "Primary environment",
    source: "window-origin",
    wsUrl: window.location.origin,
  });
}

export function resolvePrimaryEnvironmentBootstrapUrl(): string {
  const baseUrl = getPrimaryKnownEnvironment()?.target.httpBaseUrl ?? null;
  if (!baseUrl) {
    throw new Error("Unable to resolve a known environment bootstrap URL.");
  }
  return baseUrl;
}
