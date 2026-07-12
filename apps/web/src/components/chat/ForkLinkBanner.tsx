import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { GitForkIcon } from "lucide-react";
import { memo } from "react";
import { useThread } from "../../state/entities";

/**
 * Banner shown at the top of a forked thread linking back to the chat it was
 * forked from. Clicking it navigates to the source thread. The source title is
 * resolved live, so a renamed source updates here too.
 */
export const ForkLinkBanner = memo(function ForkLinkBanner(props: {
  environmentId: EnvironmentId;
  forkedFromThreadId: ThreadId;
  onOpenSource: (threadId: ThreadId) => void;
}) {
  const sourceThread = useThread(scopeThreadRef(props.environmentId, props.forkedFromThreadId));
  const sourceTitle = sourceThread?.title?.trim();
  return (
    <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-muted-foreground text-xs">
      <GitForkIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="shrink-0">Forked from</span>
      <button
        type="button"
        onClick={() => props.onOpenSource(props.forkedFromThreadId)}
        className="min-w-0 truncate font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
        title={sourceTitle && sourceTitle.length > 0 ? sourceTitle : "Open the source chat"}
      >
        {sourceTitle && sourceTitle.length > 0 ? sourceTitle : "the original chat"}
      </button>
    </div>
  );
});
