import type { ProviderDriverKind } from "@t3tools/contracts";
import type { AccountQuotaSnapshot } from "@t3tools/contracts/quota";
import type { ReactElement } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { QuotaAccountDetails } from "./QuotaAccountDetails";

export function ProviderQuotaTooltip({
  trigger,
  snapshot,
  driverKind,
  nowMs,
  side = "right",
}: {
  readonly trigger: ReactElement;
  readonly snapshot: AccountQuotaSnapshot | undefined;
  readonly driverKind: ProviderDriverKind;
  readonly nowMs: number;
  readonly side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipPopup className={snapshot ? undefined : "max-w-56"} side={side}>
        {snapshot ? (
          <QuotaAccountDetails nowMs={nowMs} snapshot={snapshot} />
        ) : driverKind === "codex" || driverKind === "claudeAgent" ? (
          "No quota data yet. Send a message with this account, then refresh limits."
        ) : (
          "This provider does not expose subscription quota to OmniCode yet."
        )}
      </TooltipPopup>
    </Tooltip>
  );
}
