import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { get } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { generateText } from "ai";

import { prisma } from "@/lib/db";
import { fetchWhatsAppMedia, WHATSAPP_MEDIA_TTL_MS } from "@/lib/meta/media";

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
const TRANSCRIBE_TIMEOUT_MS = 25_000;
/** Intentos de la tanda pendiente por audio: uno que no se puede bajar o no se entiende no se reintenta siempre. */
const MAX_TRIES = 3;

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
    // Corre dentro del webhook: si el modelo tarda, el audio queda sin texto
    // (lo recoge la tanda pendiente) antes que hacer reintentar a WhatsApp.
    abortSignal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
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

type StoredAtt = {
  kind?: string;
  url?: string | null;
  mimeType?: string | null;
  mediaId?: string;
  unavailableReason?: string;
  transcriptTries?: number;
};

const readBlob = async (url: string): Promise<ArrayBuffer | null> => {
  const result = await get(url, { access: "private" }).catch(() => null);
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).arrayBuffer();
};

/**
 * Transcribe los audios que quedaron sin texto (los que llegaron antes de que
 * existiera esto, o cuando Blob no aceptó el archivo: entonces se pide a
 * WhatsApp por su id, que lo guarda 7 días). Devuelve cuántos transcribió.
 * Después vuelve a aprender de los chats tocados, para que las respuestas en
 * audio de Dayana cuenten como ejemplos de su forma de hablar.
 *
 * Solo mira audios (antes tomaba cualquier adjunto sin texto y las fotos sin
 * pie llenaban el cupo: los audios viejos nunca llegaban).
 */
export const transcribePendingAudio = async (input: {
  conversationId?: string;
  limit?: number;
}): Promise<number> => {
  const limit = input.limit ?? 40;
  const conversationFilter = input.conversationId ? Prisma.sql`AND m.conversation_id = ${input.conversationId}` : Prisma.empty;
  const messages = await prisma.$queryRaw<{ id: string; conversation_id: string; attachments: unknown; sent_at: Date }[]>`
    SELECT m.id, m.conversation_id, m.attachments, m.sent_at
      FROM conversation_messages m
      JOIN conversations c ON c.id = m.conversation_id AND c.channel = 'WHATSAPP'
     WHERE (m.body IS NULL OR m.body = '')
       AND jsonb_typeof(m.attachments) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(m.attachments) a
          WHERE a->>'kind' = 'audio'
            AND COALESCE((a->>'transcriptTries')::int, 0) < ${MAX_TRIES}
            AND (a->>'url' IS NOT NULL
                 OR (a->>'mediaId' IS NOT NULL AND m.sent_at > now() - interval '6 days'))
       )
       ${conversationFilter}
     ORDER BY m.sent_at DESC
     LIMIT ${limit}`;
  const touched = new Set<string>();
  let done = 0;
  // Un intento fallido queda anotado en el adjunto; a los 3 no se vuelve a probar.
  const noteFailure = async (id: string, attachments: StoredAtt[]) => {
    const next = attachments.map((a) => (a.kind === "audio" ? { ...a, transcriptTries: (a.transcriptTries ?? 0) + 1 } : a));
    await prisma.conversationMessage
      .updateMany({ where: { id, OR: [{ body: null }, { body: "" }] }, data: { attachments: next as unknown as Prisma.InputJsonValue } })
      .catch(() => undefined);
  };
  for (const m of messages) {
    const list = Array.isArray(m.attachments) ? (m.attachments as StoredAtt[]) : [];
    const audio = list.find((a) => a.kind === "audio");
    if (!audio) continue;
    try {
      let bytes: ArrayBuffer | null = null;
      let mimeType = audio.mimeType ?? "audio/ogg";
      if (audio.url) {
        bytes = await readBlob(audio.url);
      } else if (audio.mediaId && Date.now() - m.sent_at.getTime() < WHATSAPP_MEDIA_TTL_MS) {
        const media = await fetchWhatsAppMedia(audio.mediaId);
        if (media) {
          bytes = media.buffer;
          mimeType = audio.mimeType ?? media.contentType;
        }
      }
      if (!bytes) {
        await noteFailure(m.id, list);
        continue;
      }
      const transcript = await transcribeAudio(bytes, mimeType);
      if (!transcript) {
        await noteFailure(m.id, list);
        continue;
      }
      // Solo si sigue sin texto: otra pasada (o el reintento) pudo ganarle.
      const updated = await prisma.conversationMessage.updateMany({
        where: { id: m.id, OR: [{ body: null }, { body: "" }] },
        data: { body: transcriptBody(transcript) },
      });
      if (updated.count === 0) continue;
      touched.add(m.conversation_id);
      done++;
    } catch (e) {
      console.warn("[transcripción] no se pudo transcribir un audio", e);
      await noteFailure(m.id, list);
    }
  }
  if (touched.size > 0) {
    const { learnFromConversation } = await import("../whatsapp-learning");
    for (const id of touched) await learnFromConversation(id).catch(() => undefined);
  }
  return done;
};
