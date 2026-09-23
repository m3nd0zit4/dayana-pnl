import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { get } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { generateText } from "ai";

import { prisma } from "@/lib/db";

/**
 * Las notas de voz, en texto.
 *
 * La IA no puede «oír» un audio a la hora de contestar ni aprender de un audio
 * de Dayana: por eso cada nota de voz (de la persona o de Dayana) se transcribe
 * con Gemini —que entiende audio directamente, sin costo en el nivel gratuito—
 * y el texto queda como cuerpo del mensaje con un 🎤 delante. Así lo leen la
 * IA, el aprendizaje de su estilo y quien abre el chat en el CRM.
 */

export const TRANSCRIPT_MARK = "🎤 ";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

export const transcribeAudio = async (
  bytes: ArrayBuffer | Uint8Array,
  mimeType: string
): Promise<string | null> => {
  if (!process.env.GEMINI_API_KEY?.trim()) return null;
  const { text } = await generateText({
    model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Transcribe esta nota de voz de WhatsApp tal cual, en su idioma original, con puntuación natural. Devuelve SOLO la transcripción, sin comillas ni comentarios. Si no se entiende nada, devuelve exactamente: (inaudible)",
          },
          {
            type: "file",
            data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
            mediaType: mimeType.split(";")[0].trim() || "audio/ogg",
          },
        ],
      },
    ],
  });
  const clean = text.trim();
  return clean ? clean.slice(0, 4000) : null;
};

/** Texto que queda como cuerpo de un mensaje de audio. */
export const transcriptBody = (transcript: string): string => `${TRANSCRIPT_MARK}${transcript}`;

type StoredAtt = { kind?: string; url?: string | null; mimeType?: string | null };

const readBlob = async (url: string): Promise<ArrayBuffer | null> => {
  const result = await get(url, { access: "private" }).catch(() => null);
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).arrayBuffer();
};

/**
 * Transcribe los audios que quedaron sin texto (los que llegaron antes de que
 * existiera esto). Devuelve cuántos transcribió. Después vuelve a aprender de
 * los chats tocados, para que las respuestas en audio de Dayana cuenten como
 * ejemplos de su forma de hablar.
 */
export const transcribePendingAudio = async (input: {
  conversationId?: string;
  limit?: number;
}): Promise<number> => {
  const messages = await prisma.conversationMessage.findMany({
    where: {
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      OR: [{ body: null }, { body: "" }],
      attachments: { not: Prisma.DbNull },
      conversation: { channel: "WHATSAPP" },
    },
    orderBy: { sentAt: "desc" },
    take: input.limit ?? 40,
    select: { id: true, conversationId: true, attachments: true },
  });
  const touched = new Set<string>();
  let done = 0;
  for (const m of messages) {
    const audio = (Array.isArray(m.attachments) ? (m.attachments as StoredAtt[]) : []).find(
      (a) => a.kind === "audio" && a.url
    );
    if (!audio?.url) continue;
    try {
      const bytes = await readBlob(audio.url);
      if (!bytes) continue;
      const transcript = await transcribeAudio(bytes, audio.mimeType ?? "audio/ogg");
      if (!transcript) continue;
      await prisma.conversationMessage.update({
        where: { id: m.id },
        data: { body: transcriptBody(transcript) },
      });
      touched.add(m.conversationId);
      done++;
    } catch (e) {
      console.warn("[transcripción] no se pudo transcribir un audio", e);
    }
  }
  if (touched.size > 0) {
    const { learnFromConversation } = await import("../whatsapp-learning");
    for (const id of touched) await learnFromConversation(id).catch(() => undefined);
  }
  return done;
};
