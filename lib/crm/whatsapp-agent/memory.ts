import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { prisma } from "@/lib/db";

/**
 * Memoria por persona (la idea de MEMORY.md / USER.md de Hermes Agent).
 *
 * Unas pocas líneas que la IA quiere recordar la próxima vez que esa persona
 * escriba: qué busca, en qué va, qué se le prometió, cómo prefiere que le
 * hablen. No es el historial —ese ya lo lee entero—, es lo que sobrevive a él:
 * un chat de hace tres meses no entra en los últimos 40 mensajes, pero «tiene
 * dos hijos y prefiere las tardes» sí debería.
 *
 * La escribe la IA después de contestar y Dayana la puede corregir a mano.
 */

const MAX_NOTES = 1500;

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

export const getMemory = async (phone: string): Promise<string | null> => {
  const row = await prisma.whatsAppMemory.findUnique({
    where: { phone },
    select: { notes: true },
  });
  return row?.notes?.trim() || null;
};

export const setMemory = async (
  phone: string,
  notes: string,
  contactId?: string | null
): Promise<void> => {
  const clean = notes.trim().slice(0, MAX_NOTES);
  if (!clean) {
    await prisma.whatsAppMemory.deleteMany({ where: { phone } });
    return;
  }
  await prisma.whatsAppMemory.upsert({
    where: { phone },
    create: { phone, notes: clean, contactId: contactId ?? null },
    update: { notes: clean, ...(contactId ? { contactId } : {}) },
  });
};

/**
 * Pone al día la memoria con lo último que se habló. Barato a propósito: pocas
 * líneas de entrada y de salida. Si no hay nada nuevo que valga la pena, la
 * deja igual.
 */
export const refreshMemory = async (input: {
  phone: string;
  contactId: string | null;
  transcript: { direction: "INBOUND" | "OUTBOUND"; body: string | null }[];
}): Promise<void> => {
  if (!process.env.GEMINI_API_KEY?.trim()) return;
  const previous = (await getMemory(input.phone)) ?? "";
  const recent = input.transcript
    .slice(-12)
    .map(
      (m) =>
        `${m.direction === "INBOUND" ? "PERSONA" : "NOSOTROS"}: ${m.body?.trim() || "(adjunto)"}`
    )
    .join("\n");

  const { text } = await generateText({
    model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"),
    system:
      "Mantienes la ficha breve de una persona que escribe al WhatsApp de una terapeuta. Guardas solo hechos útiles para atenderla mejor la próxima vez: nombre, qué busca, en qué proceso va, citas o pagos mencionados, lo que se le prometió, preferencias (horarios, trato). Nada clínico íntimo más allá de una frase general. Máximo 8 viñetas cortas. Si la conversación no añade nada nuevo, devuelve la ficha anterior tal cual. Devuelve SOLO la ficha.",
    prompt: `FICHA ANTERIOR:\n${previous || "(vacía)"}\n\nCONVERSACIÓN RECIENTE:\n${recent}`,
  });

  const next = text.trim();
  if (next && next !== previous) {
    await setMemory(input.phone, next, input.contactId);
  }
};
