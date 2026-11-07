"use client";

import type { ThreadOpener } from "@/lib/agent-ui/threads";
import { Message, MessageContent, MessageResponse } from "../ai-elements/message";

const OPENER_DATE = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const openerDate = (iso: string): string | null => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) || date.getTime() === 0 ? null : OPENER_DATE.format(date);
};

/**
 * The assistant's first message when it started the conversation: an ordinary
 * assistant bubble (same markdown) under a small caption saying who wrote and when.
 */
export const OpenerBubble = ({ opener }: { opener: ThreadOpener }) => {
  const when = openerDate(opener.createdAt);
  return (
    <Message from="assistant" data-testid="agent-opener">
      <MessageContent>
        <p className="text-xs text-muted-foreground">
          Te escribió el asistente{when ? ` · ${when}` : ""}
        </p>
        <MessageResponse>{opener.message}</MessageResponse>
      </MessageContent>
    </Message>
  );
};
