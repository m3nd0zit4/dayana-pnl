/**
 * «Pregúntale al asistente» from a WhatsApp chat that is waiting for Dayana
 * (the WhatsApp AI didn't know what to answer, escalated, or left a proposal).
 * The panel opens on the WhatsApp specialist with this text as its first line;
 * Dayana answers in her own words («dile que sí, que el jueves a las 3») and the
 * specialist writes and sends it (one approval card), and can keep it as an
 * instruction for that chat so the AI answers it that way next time.
 *
 * Pure: the chat view in, the opener's title and message out.
 */

export type ChatHelpInput = {
  name: string;
  /** WhatsApp id digits («573001234567»). */
  phone: string;
  /** Why the chat waits for her, already in words («No sabe qué responder»). */
  reason: string | null;
  /** The extra line the chat header shows, if any. */
  detail?: string | null;
  messages: readonly { direction: "INBOUND" | "OUTBOUND"; body: string | null; kind?: string }[];
};

const MAX_QUOTE = 400;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Her last messages since our last reply (what is still unanswered), joined. */
export const unansweredText = (messages: ChatHelpInput["messages"]): string | null => {
  const tail: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === "system") continue;
    if (m.direction === "OUTBOUND") break;
    if (m.body?.trim()) tail.unshift(m.body.trim());
  }
  if (tail.length > 0) return clip(tail.join(" / "), MAX_QUOTE);
  // Nothing new from her: quote the last thing she said.
  const last = [...messages].reverse().find((m) => m.direction === "INBOUND" && m.body?.trim());
  return last?.body ? clip(last.body, MAX_QUOTE) : null;
};

export const chatHelpOpener = (chat: ChatHelpInput): { title: string; message: string } => {
  const who = `${chat.name}${chat.name.includes(chat.phone) ? "" : ` (+${chat.phone})`}`;
  const said = unansweredText(chat.messages);
  const why = [chat.reason, chat.detail].filter(Boolean).join(" · ");
  const lines = [
    said ? `${who} escribió: «${said}».` : `El chat de ${who} te espera.`,
    why ? `La IA de WhatsApp lo dejó para ti (${why}).` : "La IA de WhatsApp lo dejó para ti.",
    "Dime qué quieres contestarle, con tus palabras: yo lo redacto y se lo mando (te muestro el mensaje para que lo apruebes). Si quieres, también lo dejo como instrucción para que la IA le responda así la próxima vez.",
  ];
  return { title: `¿Qué le contesto a ${chat.name}?`.slice(0, 120), message: lines.join("\n\n") };
};
