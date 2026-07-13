// FILE: ForkedFromBanner.tsx
// Purpose: Thin banner shown at the top of a thread that was created by forking
// another conversation. Links back to the source thread.

import { memo } from "react";

import { useForkLinkStore } from "../../forkLinkStore";
import { GitForkIcon } from "~/lib/icons";

export const ForkedFromBanner = memo(function ForkedFromBanner(props: {
  threadKey: string | null;
  onOpenSource: (environmentId: string, threadId: string) => void;
}) {
  const link = useForkLinkStore((store) =>
    props.threadKey ? (store.linksByThreadKey[props.threadKey] ?? null) : null,
  );
  if (!link) return null;

  const sourceLabel = link.sourceTitle?.trim() || "the original thread";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3">
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground">
        <GitForkIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          Forked from <span className="font-medium text-foreground">{sourceLabel}</span>
          {link.targetProviderDisplayName ? (
            <span> · now on {link.targetProviderDisplayName}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => props.onOpenSource(link.sourceEnvironmentId, link.sourceThreadId)}
          className="shrink-0 font-medium text-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          View original
        </button>
      </div>
    </div>
  );
});
