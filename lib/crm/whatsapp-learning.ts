import { createHash } from "node:crypto";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Prisma } from "@prisma/client";
import { embed, embedMany, generateText } from "ai";

import { prisma } from "@/lib/db";
import { getTeamPhones } from "./chat-category";
import { isTeamThread } from "./chat-category-rules";
import { isIgnoredNumber } from "./whatsapp-ignored-numbers";
import { isHumanReply, isLearnableChat, REPEATED_MIN_CHARS, REPEATED_MIN_CHATS } from "./whatsapp-learning-rules";
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

/**
 * Mensajes que escribió Dayana contestando, en SQL (mismo criterio que
 * `isHumanReply`): sin la IA, sin sus borradores aprobados, sin lo que sale
 * solo y sin los avisos grises. `m` es `conversation_messages`.
 */
export const humanReplySql = Prisma.sql`
  m.direction = 'OUTBOUND' AND m.is_auto_reply = false AND m.kind <> 'system'
  AND (m.source IS NULL OR (m.source <> 'approval' AND m.source NOT LIKE 'bulk:%' AND m.source NOT LIKE 'recordatorio:%'
       AND m.source NOT LIKE 'evento:%' AND m.source NOT LIKE 'taller:%'))
  AND (m.client_key IS NULL OR (m.client_key NOT LIKE 'welcome:%' AND m.client_key NOT LIKE 'reminder:%'
       AND m.client_key NOT LIKE 'bulk:%' AND m.client_key NOT LIKE 'taller:%'))`;

/**
 * Chats de los que no se aprende, en SQL (`c` es `conversations`, `d` su
 * ficha): lo que ya se sabe personal, del equipo o de una empresa.
 */
export const notLearnableChatSql = Prisma.sql`(
  COALESCE(d.segment, '') = 'ignored'
  OR (c.category IN ('personal', 'negocio', 'equipo')
      AND (c.category_source = 'manual' OR (COALESCE(c.category_confidence, 0) >= 0.9 AND NOT c.category_review))))`;

/** De estos chats, los que sí enseñan (sin personales, equipo ni empresas). */
export const learnableConversations = async (ids: string[]): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const [rows, teamPhones] = await Promise.all([
    prisma.conversation.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        channel: true,
        externalThreadId: true,
        category: true,
        categorySource: true,
        categoryConfidence: true,
        categoryReview: true,
        dossier: { select: { segment: true } },
      },
    }),
    getTeamPhones().catch(() => [] as string[]),
  ]);
  const ok = new Set<string>();
  for (const c of rows) {
    if (c.channel !== "WHATSAPP") continue;
    const learnable = isLearnableChat({
      isTeam: isTeamThread(c.externalThreadId, teamPhones),
      ignoredNumber: await isIgnoredNumber(c.externalThreadId),
      segment: c.dossier?.segment,
      category: c.category,
      categorySource: c.categorySource,
      categoryConfidence: c.categoryConfidence,
      categoryReview: c.categoryReview,
    });
    if (learnable) ok.add(c.id);
  }
  return ok;
};

const pairsOfConversation = async (conversationId: string, take?: number) => {
  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId, kind: { not: "system" } },
    orderBy: { sentAt: take ? "desc" : "asc" },
    ...(take ? { take } : {}),
    select: {
      id: true,
      direction: true,
      body: true,
      sentAt: true,
      isAutoReply: true,
      kind: true,
      source: true,
      clientKey: true,
    },
  });
  return extractReplyPairs(
    messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      sentAt: m.sentAt,
      isHuman: isHumanReply(m),
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
    if (!(await learnableConversations([conversationId])).has(conversationId)) return;
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
    if (!(await learnableConversations([conversationId])).has(conversationId)) return;
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
  const learnable = await learnableConversations(conversations.map((c) => c.id));
  for (const { id } of conversations) {
    if (!learnable.has(id)) continue;
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

/** El texto de la respuesta, normalizado igual que `normalizeReply`. */
const normalizedReplySql = Prisma.sql`btrim(lower(regexp_replace(reply_text, '[[:space:]]+', ' ', 'g')))`;

/**
 * Respuestas que son plantillas (el mismo texto largo en muchos chats: la
 * respuesta rápida de la app, la bienvenida, una difusión). No enseñan.
 */
export const repeatedRepliesSql = Prisma.sql`
  SELECT ${normalizedReplySql} AS t FROM whatsapp_reply_examples
  WHERE conversation_id IS NOT NULL AND length(${normalizedReplySql}) >= ${REPEATED_MIN_CHARS}
  GROUP BY 1 HAVING count(DISTINCT conversation_id) >= ${REPEATED_MIN_CHATS}`;

/**
 * Las plantillas, guardadas un rato: se buscan ejemplos en cada mensaje y
 * agrupar toda la tabla cada vez sería caro. Una plantilla nueva tarda como
 * mucho `REPEATED_TTL_MS` en dejar de usarse.
 */
const REPEATED_TTL_MS = 10 * 60_000;
let repeatedCache: { at: number; texts: string[] } | null = null;

export const repeatedReplyTexts = async (): Promise<string[]> => {
  if (repeatedCache && Date.now() - repeatedCache.at < REPEATED_TTL_MS) return repeatedCache.texts;
  const rows = await prisma.$queryRaw<{ t: string }[]>`${repeatedRepliesSql}`;
  repeatedCache = { at: Date.now(), texts: rows.map((r) => r.t) };
  return repeatedCache.texts;
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
  const repeated = await repeatedReplyTexts();

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
      AND ${normalizedReplySql} <> ALL(${repeated}::text[])
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
  // Al azar entre todo lo aprendido (también el historial importado), no solo
  // lo último: la guía describe cómo escribe Dayana, no cómo escribió esta
  // semana. Sin plantillas pegadas en muchos chats.
  const rows = await prisma.$queryRaw<{ client_text: string; reply_text: string }[]>`
    SELECT client_text, reply_text FROM whatsapp_reply_examples
    WHERE is_enabled AND ${normalizedReplySql} <> ALL(${await repeatedReplyTexts()}::text[])
    ORDER BY random()
    LIMIT 80`;
  const sample = rows.map((r) => ({ clientText: r.client_text, replyText: r.reply_text }));
  if (sample.length < 5) throw new Error("not_enough_examples");

  const { text } = await generateText({
    model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"),
    system:
      "Analizas cómo escribe una persona por WhatsApp para que otra pueda imitarla. Escribes en español, en viñetas cortas, sin inventar nada que no se vea en los ejemplos.",
    prompt: `Estas son respuestas reales de Dayana a sus clientes.

${sample
  .map((s, i) => `#${i + 1}\nCLIENTE: ${s.clientText}\nDAYANA: ${s.replyText}`)
  .join("\n\n")}

Escribe una guía de estilo de máximo 200 palabras: cómo saluda, cómo trata a la persona (tú/usted, apodos cariñosos), tono, largo de los mensajes, uso de emojis y cuáles, frases o muletillas que repite, cómo cierra, cómo responde cuando le preguntan precios (sin dar valores: invita a la llamada gratis) y cómo invita a dar el siguiente paso. No incluyas precios, fechas ni enlaces concretos.`,
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
