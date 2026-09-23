import { createHash } from "node:crypto";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Prisma } from "@prisma/client";
import { embed, embedMany, generateText } from "ai";

import { prisma } from "@/lib/db";
import { extractReplyPairs, type ReplyPair } from "./whatsapp-reply-pairs";

/**
 * Lo que la IA aprende de las conversaciones reales de Dayana.
 *
 * No se entrena ningún modelo: se guardan pares reales «pregunta → respuesta
 * de Dayana» con su vector, y en cada mensaje nuevo se buscan los más
 * parecidos y se le dan al modelo como ejemplos de cómo contesta ella. Es
 * inmediato (un chat de hoy ya cuenta mañana), se puede revisar par por par y
 * apagar el que no convenga, y no depende de ningún proveedor para reentrenar.
 *
 * Los ejemplos enseñan TONO y FORMA, no datos: un precio de hace cuatro meses
 * dentro de un ejemplo está viejo. El prompt de la respuesta automática lo
 * dice explícitamente, y los datos siguen saliendo solo del CRM.
 */

const EMBEDDING_MODEL = "gemini-embedding-001";
const DIMENSIONS = 768;
/** Por encima de esto, dos mensajes tratan de lo mismo. */
const MIN_SIMILARITY = 0.55;

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

const embeddingOptions = {
  google: { outputDimensionality: DIMENSIONS, taskType: "SEMANTIC_SIMILARITY" },
} as const;

const hasModelKey = () => Boolean(process.env.GEMINI_API_KEY?.trim());

/** pgvector lee el vector como texto `[0.1,0.2,…]`. */
const toVector = (values: number[]) => `[${values.join(",")}]`;

export type ExampleSource = "inbox" | "import";

type NewExample = ReplyPair & {
  source: ExampleSource;
  sourceKey: string;
  conversationId: string | null;
};

/**
 * Guarda o actualiza ejemplos. Si el ejemplo ya existe con el mismo texto no
 * se toca (conserva si Dayana lo apagó); si el texto cambió —Dayana siguió
 * escribiendo— se actualiza y se vuelve a calcular su vector.
 */
const upsertExamples = async (examples: NewExample[]): Promise<number> => {
  if (examples.length === 0) return 0;
  const existing = await prisma.whatsAppReplyExample.findMany({
    where: { sourceKey: { in: examples.map((e) => e.sourceKey) } },
    select: { sourceKey: true, clientText: true, replyText: true },
  });
  const byKey = new Map(existing.map((e) => [e.sourceKey, e]));

  let written = 0;
  for (const example of examples) {
    const prev = byKey.get(example.sourceKey);
    if (!prev) {
      await prisma.whatsAppReplyExample.create({
        data: {
          sourceKey: example.sourceKey,
          source: example.source,
          conversationId: example.conversationId,
          clientText: example.clientText,
          replyText: example.replyText,
          repliedAt: example.repliedAt,
        },
      });
      written++;
      continue;
    }
    if (
      prev.clientText === example.clientText &&
      prev.replyText === example.replyText
    ) {
      continue;
    }
    await prisma.whatsAppReplyExample.update({
      where: { sourceKey: example.sourceKey },
      data: {
        clientText: example.clientText,
        replyText: example.replyText,
        repliedAt: example.repliedAt,
      },
    });
    // El texto de la pregunta pudo cambiar: el vector viejo ya no vale.
    await prisma.$executeRaw`
      UPDATE whatsapp_reply_examples SET embedding = NULL
      WHERE source_key = ${example.sourceKey}`;
    written++;
  }
  return written;
};

/** Calcula el vector de los ejemplos que aún no lo tienen. */
export const embedPendingExamples = async (limit = 200): Promise<number> => {
  if (!hasModelKey()) return 0;
  const pending = await prisma.$queryRaw<{ id: string; client_text: string }[]>`
    SELECT id, client_text FROM whatsapp_reply_examples
    WHERE embedding IS NULL
    ORDER BY replied_at DESC
    LIMIT ${limit}`;
  if (pending.length === 0) return 0;

  const { embeddings } = await embedMany({
    model: google.embedding(EMBEDDING_MODEL),
    values: pending.map((p) => p.client_text),
    providerOptions: embeddingOptions,
    maxParallelCalls: 2,
  });

  for (let i = 0; i < pending.length; i++) {
    await prisma.$executeRaw`
      UPDATE whatsapp_reply_examples
      SET embedding = ${toVector(embeddings[i])}::vector
      WHERE id = ${pending[i].id}`;
  }
  return pending.length;
};

const pairsOfConversation = async (conversationId: string, take?: number) => {
  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { sentAt: take ? "desc" : "asc" },
    ...(take ? { take } : {}),
    select: {
      id: true,
      direction: true,
      body: true,
      sentAt: true,
      isAutoReply: true,
    },
  });
  return extractReplyPairs(
    messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      sentAt: m.sentAt,
      isHuman: m.direction === "OUTBOUND" && !m.isAutoReply,
    }))
  );
};

const inboxExample = (conversationId: string, pair: ReplyPair): NewExample => ({
  ...pair,
  source: "inbox",
  sourceKey: `inbox:${pair.replyKey}`,
  conversationId,
});

/**
 * Aprende de la última respuesta de Dayana en un hilo. Se llama cada vez que
 * ella escribe (desde el celular o desde el CRM). Nunca lanza: va detrás del
 * webhook o de un envío que ya salió bien.
 */
export const learnFromLatestReply = async (
  conversationId: string
): Promise<void> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channel: true },
    });
    if (conversation?.channel !== "WHATSAPP") return;
    const pairs = await pairsOfConversation(conversationId, 30);
    const last = pairs.at(-1);
    if (!last) return;
    await upsertExamples([inboxExample(conversationId, last)]);
    await embedPendingExamples(5);
  } catch (e) {
    console.error("[whatsapp-learning] no se pudo aprender de la respuesta", e);
  }
};

/** Aprende de todo un hilo (al terminar de llegar su historial). */
export const learnFromConversation = async (
  conversationId: string
): Promise<void> => {
  try {
    const pairs = await pairsOfConversation(conversationId);
    await upsertExamples(
      pairs.map((pair) => inboxExample(conversationId, pair))
    );
    // Los vectores, en tandas: el historial puede traer cientos de pares.
    while ((await embedPendingExamples(100)) === 100) {
      /* sigue hasta vaciar */
    }
  } catch (e) {
    console.error("[whatsapp-learning] no se pudo aprender del hilo", e);
  }
};

export type LearnBatchResult = {
  conversations: number;
  written: number;
  embedded: number;
  /** Id desde el que seguir; null = ya se recorrió todo. */
  nextCursor: string | null;
};

/**
 * Recorre los hilos de WhatsApp por tandas y guarda sus pares. Por tandas
 * porque el historial de seis meses puede ser grande y una función del
 * servidor tiene tiempo limitado: el panel llama hasta que `nextCursor` es null.
 */
export const learnFromInbox = async (
  cursor: string | null,
  batch = 40
): Promise<LearnBatchResult> => {
  const conversations = await prisma.conversation.findMany({
    where: {
      channel: "WHATSAPP",
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: batch,
    select: { id: true },
  });

  let written = 0;
  for (const { id } of conversations) {
    const pairs = await pairsOfConversation(id);
    written += await upsertExamples(
      pairs.map((pair) => inboxExample(id, pair))
    );
  }
  const embedded = await embedPendingExamples(300);

  return {
    conversations: conversations.length,
    written,
    embedded,
    nextCursor:
      conversations.length === batch
        ? conversations[conversations.length - 1].id
        : null,
  };
};

/** Pares de un chat exportado que el navegador ya leyó y emparejó. */
export const importExamples = async (
  pairs: ReplyPair[]
): Promise<{ written: number; embedded: number }> => {
  const written = await upsertExamples(
    pairs.map((pair) => ({
      ...pair,
      source: "import" as const,
      // Un chat exportado no trae ids: el par mismo es la clave, así subir el
      // mismo archivo dos veces no duplica nada.
      sourceKey: `import:${createHash("sha256")
        .update(`${pair.clientText}\u0000${pair.replyText}`)
        .digest("hex")
        .slice(0, 40)}`,
      conversationId: null,
    }))
  );
  const embedded = await embedPendingExamples(300);
  return { written, embedded };
};

export type SimilarExample = {
  id: string;
  clientText: string;
  replyText: string;
  similarity: number;
};

/** Los ejemplos más parecidos a lo que acaba de escribir la persona. */
export const findSimilarExamples = async (
  text: string,
  limit: number
): Promise<SimilarExample[]> => {
  if (!hasModelKey() || !text.trim()) return [];
  const { embedding } = await embed({
    model: google.embedding(EMBEDDING_MODEL),
    value: text.slice(-1200),
    providerOptions: embeddingOptions,
  });
  const vector = toVector(embedding);

  const rows = await prisma.$queryRaw<
    {
      id: string;
      client_text: string;
      reply_text: string;
      similarity: number;
    }[]
  >`
    SELECT id, client_text, reply_text,
           1 - (embedding <=> ${vector}::vector) AS similarity
    FROM whatsapp_reply_examples
    WHERE is_enabled AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vector}::vector
    LIMIT ${limit}`;

  return rows
    .filter((r) => Number(r.similarity) >= MIN_SIMILARITY)
    .map((r) => ({
      id: r.id,
      clientText: r.client_text,
      replyText: r.reply_text,
      similarity: Number(r.similarity),
    }));
};

export type LearningSummary = {
  total: number;
  enabled: number;
  pendingEmbedding: number;
  imported: number;
  knownContacts: number;
  lastLearnedAt: string | null;
};

export const getLearningSummary = async (): Promise<LearningSummary> => {
  const [total, enabled, imported, knownContacts, last, pending] =
    await Promise.all([
      prisma.whatsAppReplyExample.count(),
      prisma.whatsAppReplyExample.count({ where: { isEnabled: true } }),
      prisma.whatsAppReplyExample.count({ where: { source: "import" } }),
      prisma.whatsAppKnownContact.count({ where: { removedAt: null } }),
      prisma.whatsAppReplyExample.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM whatsapp_reply_examples WHERE embedding IS NULL`,
    ]);
  return {
    total,
    enabled,
    imported,
    knownContacts,
    pendingEmbedding: Number(pending[0]?.n ?? 0),
    lastLearnedAt: last?.createdAt.toISOString() ?? null,
  };
};

export type ExampleRow = {
  id: string;
  source: string;
  clientText: string;
  replyText: string;
  isEnabled: boolean;
  repliedAt: string;
};

export const listExamples = async (input: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: ExampleRow[]; total: number }> => {
  const pageSize = Math.min(input.pageSize ?? 20, 50);
  const page = Math.max(input.page ?? 1, 1);
  const q = input.q?.trim();
  const where: Prisma.WhatsAppReplyExampleWhereInput = q
    ? {
        OR: [
          { clientText: { contains: q, mode: "insensitive" } },
          { replyText: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    prisma.whatsAppReplyExample.findMany({
      where,
      orderBy: { repliedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        source: true,
        clientText: true,
        replyText: true,
        isEnabled: true,
        repliedAt: true,
      },
    }),
    prisma.whatsAppReplyExample.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, repliedAt: r.repliedAt.toISOString() })),
    total,
  };
};

/**
 * Escribe, a partir de respuestas reales, una guía corta de cómo escribe
 * Dayana. Es un borrador: se muestra en el panel para que ella lo corrija
 * antes de guardarlo.
 */
export const draftStyleGuide = async (): Promise<string> => {
  if (!hasModelKey()) throw new Error("no_model_key");
  const sample = await prisma.whatsAppReplyExample.findMany({
    where: { isEnabled: true },
    orderBy: { repliedAt: "desc" },
    take: 80,
    select: { clientText: true, replyText: true },
  });
  if (sample.length < 5) throw new Error("not_enough_examples");

  const { text } = await generateText({
    model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"),
    system:
      "Analizas cómo escribe una persona por WhatsApp para que otra pueda imitarla. Escribes en español, en viñetas cortas, sin inventar nada que no se vea en los ejemplos.",
    prompt: `Estas son respuestas reales de Dayana a sus clientes.

${sample
  .map((s, i) => `#${i + 1}\nCLIENTE: ${s.clientText}\nDAYANA: ${s.replyText}`)
  .join("\n\n")}

Escribe una guía de estilo de máximo 200 palabras: cómo saluda, cómo trata a la persona (tú/usted, apodos cariñosos), tono, largo de los mensajes, uso de emojis y cuáles, frases o muletillas que repite, cómo cierra, cómo habla de precios y cómo invita a dar el siguiente paso. No incluyas precios, fechas ni enlaces concretos.`,
  });
  return text.trim().slice(0, 4000);
};

// ── Libreta de contactos de la app (coexistencia) ──────────────────────────

export const upsertKnownContact = async (input: {
  phone: string;
  name: string | null;
  action: "add" | "remove";
}): Promise<void> => {
  await prisma.whatsAppKnownContact.upsert({
    where: { phone: input.phone },
    create: {
      phone: input.phone,
      name: input.name,
      removedAt: input.action === "remove" ? new Date() : null,
    },
    update: {
      ...(input.name ? { name: input.name } : {}),
      removedAt: input.action === "remove" ? new Date() : null,
    },
  });
};
