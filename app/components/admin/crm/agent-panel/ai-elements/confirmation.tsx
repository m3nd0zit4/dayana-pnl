"use client";

import type { ComponentProps } from "react";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Ported from Vercel AI Elements' confirmation.tsx (see conversation.tsx
 * header comment), trimmed to a plain building-block set: this app's HITL
 * state machine (eve's approval-requested/-responded) doesn't map onto AI
 * SDK's boolean tool-approval shape the original component was built
 * around, so the accept/reject context/hooks were dropped — callers branch
 * on `part.state` directly instead, same as the rest of AgentMessage.tsx.
 */
export type ConfirmationProps = ComponentProps<typeof Alert>;
export const Confirmation = ({ className, ...props }: ConfirmationProps) => (
  <Alert className={cn("flex flex-col gap-2", className)} {...props} />
);

export type ConfirmationTitleProps = ComponentProps<typeof AlertDescription>;
export const ConfirmationTitle = ({ className, ...props }: ConfirmationTitleProps) => (
  <AlertDescription className={cn("text-foreground", className)} {...props} />
);

export type ConfirmationActionsProps = ComponentProps<"div">;
export const ConfirmationActions = ({ className, ...props }: ConfirmationActionsProps) => (
  <div className={cn("flex flex-wrap items-center gap-2", className)} {...props} />
);

export type ConfirmationActionProps = ComponentProps<typeof Button>;
export const ConfirmationAction = (props: ConfirmationActionProps) => (
  <Button className="h-8 px-3 text-sm" type="button" {...props} />
);
