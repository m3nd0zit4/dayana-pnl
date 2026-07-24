import type { EveDynamicToolPart, EveMessagePart } from "eve/react";

export type RenderItem = { type: "part"; part: EveMessagePart } | { type: "tool-group"; parts: EveDynamicToolPart[] };

/**
 * Approval-gated calls (write tools awaiting Yes/No, and `ask_question`,
 * which shares the same approval-requested/-responded state machine) stay
 * standalone — they're actionable/blocking, not passive activity to fold
 * into a silent "N steps completed" summary.
 */
const isGroupableToolPart = (part: EveMessagePart): part is EveDynamicToolPart =>
  part.type === "dynamic-tool" &&
  part.toolName !== "ask_question" &&
  part.state !== "approval-requested" &&
  part.state !== "approval-responded";

/** Collapses consecutive groupable dynamic-tool parts of one message into a single render item; everything else passes through untouched. */
export const groupToolParts = (parts: readonly EveMessagePart[]): RenderItem[] => {
  const items: RenderItem[] = [];
  for (const part of parts) {
    if (isGroupableToolPart(part)) {
      const last = items.at(-1);
      if (last?.type === "tool-group") {
        last.parts.push(part);
      } else {
        items.push({ type: "tool-group", parts: [part] });
      }
    } else {
      items.push({ type: "part", part });
    }
  }
  return items;
};
