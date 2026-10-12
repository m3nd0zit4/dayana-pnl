import { strFromU8, unzipSync } from "fflate";

import { prisma } from "@/lib/db";
import { contactPhoneCandidates, processHistoryEvents } from "@/lib/meta/ingest";
import { resolveWhatsAppCredentials } from "@/lib/meta/whatsapp-provider";
import { isWhatsAppUserId, whatsAppDigits } from "@/lib/whatsapp-contact";
import { getOperationalTimezone } from "./operational-timezone";
import { foldForSearch } from "./search-normalize";
import { classifyWithAi } from "./chat-category-ai";
import { isTeamThread } from "./chat-category-rules";
import { getTeamPhones } from "./chat-category";
import { isIgnoredNumber } from "./whatsapp-ignored-numbers";
import {
  classifyExportRules,
  decideExport,
  type ExportClassification,
  type ExportClassifyInput,
  type ExportDecision,
} from "./whatsapp-export-classify";
import {
  detectDayanaAuthor,
  normalizePhoneInput,
  parseExportFile,
  toHistoryEvents,
  type ParsedExportFile,
} from "./whatsapp-export-history";

/**
 * Importar chats exportados desde el celular de Dayana como chats de verdad
 * del CRM (Conversation + ConversationMessage), por el mismo camino que el
 * historial de coexistencia: `processHistoryEvents` guarda sin avisar ni
 * contestar y al final aprende de las respuestas de Dayana.
 */

export type ExportTextFile = { fileName: string; text: string };

/** Los .txt que trae un archivo subido (un .txt suelto o un .zip). */
export const exportTextsFromUpload = (fileName: string, bytes: Uint8Array): ExportTextFile[] => {
  const isZip = /\.zip$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (!isZip) return [{ fileName, text: strFromU8(bytes) }];
  const entries = unzipSync(bytes, {
    filter: (file) => /\.txt$/i.test(file.name) && !file.name.startsWith("__MACOSX"),
  });
  return Object.entries(entries).map(([name, data]) => {
    const inner = name.split("/").pop() ?? name;
    // iPhone lo llama siempre «_chat.txt»: el nombre útil es el del .zip.
    return { fileName: /^_chat\.txt$/i.test(inner) ? fileName : inner, text: strFromU8(data) };
  });
};

export type ExportMatchCandidate = {
  kind: "contact" | "chat";
  id: string;
  name: string;
  phoneE164: string;
};

export type ExportFilePreview = {
  fileName: string;
  contactName: string;
  phoneE164: string | null;
  authors: string[];
  dayanaAuthor: string | null;
  messageCount: number;
  firstAt: string | null;
  lastAt: string | null;
  candidates: ExportMatchCandidate[];
  /** Más de dos personas escribiendo: es un grupo y no se importa. */
  isGroup: boolean;
  /** ¿Trabajo o personal? Lo personal no se sube al CRM. */
  classification: ExportClassification & { source: "rules" | "ai" };
  /** Lo que se propone: importar, saltar o que Dayana revise. */
  decision: ExportDecision;
  /** El número ya está en la lista de personales: no se importa. */
  ignored: boolean;
};

const looksLikePhone = (value: string | null | undefined) => Boolean(value && normalizePhoneInput(value));

const fullName = (c: { firstName: string; lastName: string | null; displayName: string | null }) =>
  c.displayName?.trim() || [c.firstName, c.lastName].filter(Boolean).join(" ");

/** Contactos y chats que podrían ser esta persona (por teléfono o por nombre). */
export const findExportCandidates = async (
  contactName: string,
  phoneE164: string | null
): Promise<ExportMatchCandidate[]> => {
  const out: ExportMatchCandidate[] = [];
  const seenPhones = new Set<string>();
  const push = (candidate: ExportMatchCandidate) => {
    const key = whatsAppDigits(candidate.phoneE164);
    if (seenPhones.has(key) || out.length >= 5) return;
    seenPhones.add(key);
    out.push(candidate);
  };
  const contactSelect = { id: true, firstName: true, lastName: true, displayName: true, phoneE164: true } as const;

  if (phoneE164) {
    const byPhone = await prisma.contact.findMany({
      where: { phoneE164: { in: contactPhoneCandidates(whatsAppDigits(phoneE164)) } },
      select: contactSelect,
      take: 2,
    });
    byPhone.forEach((c) => push({ kind: "contact", id: c.id, name: fullName(c), phoneE164: c.phoneE164 }));
  }

  const tokens = foldForSearch(contactName)
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length >= 2)
    .slice(0, 4);
  if (tokens.length === 0 || looksLikePhone(contactName)) return out;

  const contacts = await prisma.contact.findMany({
    where: {
      AND: tokens.map((t) => ({ searchText: { contains: t } })),
      phoneE164: { startsWith: "+" },
    },
    select: contactSelect,
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  contacts
    .filter((c) => /^\+\d{8,15}$/.test(c.phoneE164))
    .forEach((c) => push({ kind: "contact", id: c.id, name: fullName(c), phoneE164: c.phoneE164 }));

  const chats = await prisma.conversation.findMany({
    where: {
      channel: "WHATSAPP",
      AND: tokens.map((t) => ({ participantName: { contains: t, mode: "insensitive" as const } })),
    },
    select: { id: true, participantName: true, externalThreadId: true },
    orderBy: { lastMessageAt: "desc" },
    take: 5,
  });
  chats
    .filter((c) => !isWhatsAppUserId(c.externalThreadId) && /^\d{8,15}$/.test(c.externalThreadId))
    .forEach((c) =>
      push({ kind: "chat", id: c.id, name: c.participantName ?? c.externalThreadId, phoneE164: `+${c.externalThreadId}` })
    );

  return out;
};

/** Lo que el CRM sabe de un número: si pagó, se inscribió, agendó… o es del equipo. */
export const crmFactsForPhone = async (
  phoneE164: string | null,
  teamPhones: string[]
): Promise<NonNullable<ExportClassifyInput["crm"]>> => {
  if (!phoneE164) return {};
  const thread = whatsAppDigits(phoneE164);
  const contacts = await prisma.contact.findMany({
    where: { phoneE164: { in: contactPhoneCandidates(thread) } },
    select: { id: true },
    take: 3,
  });
  const ids = contacts.map((c) => c.id);
  const [payments, enrollments, diagnostics, webinars, appointments] = ids.length
    ? await Promise.all([
        prisma.payment.count({ where: { status: "APPROVED", enrollment: { contactId: { in: ids } } } }),
        prisma.enrollment.count({ where: { contactId: { in: ids } } }),
        prisma.diagnostic.count({ where: { contactId: { in: ids } } }),
        prisma.webinarRegistration.count({ where: { contactId: { in: ids } } }),
        prisma.calendarAppointment.count({ where: { contactId: { in: ids } } }),
      ])
    : [0, 0, 0, 0, 0];
  return {
    isTeam: isTeamThread(thread, teamPhones),
    hasPayment: payments > 0,
    hasEnrollment: enrollments > 0,
    hasDiagnostic: diagnostics > 0,
    hasWebinar: webinars > 0,
    hasAppointment: appointments > 0,
  };
};

/** Las primeras y las últimas líneas: el modelo no necesita el chat entero para saber si es trabajo. */
const AI_SAMPLE = 15;

/**
 * Lo que las reglas no saben decidir, lo mira el modelo pequeño (las mismas
 * reglas de privacidad que al clasificar chats: números y correos tapados).
 * Si no hay modelo o falla, queda «revisar».
 */
const classifyWithModel = async (
  parsed: ParsedExportFile,
  dayanaAuthor: string | null
): Promise<(ExportClassification & { source: "ai" }) | null> => {
  if (!process.env.GEMINI_API_KEY?.trim()) return null;
  const sample =
    parsed.messages.length <= AI_SAMPLE * 2
      ? parsed.messages
      : [...parsed.messages.slice(0, AI_SAMPLE), ...parsed.messages.slice(-AI_SAMPLE)];
  try {
    const verdict = await classifyWithAi({
      messages: sample.map((m) => ({
        direction: dayanaAuthor && m.author === dayanaAuthor ? "OUTBOUND" : "INBOUND",
        body: m.body,
        isEcho: false,
      })),
      hints: ["Chat antiguo exportado del celular de Dayana (antes de conectar el CRM)."],
    });
    const reasons = [verdict.reason];
    // Una empresa o un bot tampoco es una clienta: no se sube, igual que lo personal.
    if (verdict.category === "personal" || verdict.category === "negocio") {
      return { verdict: "personal", confidence: verdict.confidence, reasons, source: "ai" };
    }
    if (verdict.category === "otro") return { verdict: "unknown", confidence: verdict.confidence, reasons, source: "ai" };
    return { verdict: "business", confidence: verdict.confidence, reasons, source: "ai" };
  } catch (e) {
    console.warn("[importar chats] la IA no pudo clasificar", e instanceof Error ? e.message : e);
    return null;
  }
};

const previewOf = async (
  file: ExportTextFile,
  parsed: ParsedExportFile,
  teamPhones: string[]
): Promise<ExportFilePreview> => {
  const candidates = await findExportCandidates(parsed.contactName, parsed.phoneFromName);
  const dates = parsed.messages.map((m) => m.sentAt.getTime());
  const phoneE164 = parsed.phoneFromName ?? candidates[0]?.phoneE164 ?? null;
  const dayanaAuthor = detectDayanaAuthor(parsed.authors, { contactName: parsed.contactName });

  const rules = classifyExportRules({
    authors: parsed.authors,
    dayanaAuthor,
    messages: parsed.messages,
    crm: await crmFactsForPhone(phoneE164, teamPhones),
  });
  let classification: ExportFilePreview["classification"] = { ...rules, source: "rules" };
  if (decideExport(rules) === "review") {
    const ai = await classifyWithModel(parsed, dayanaAuthor);
    if (ai) classification = ai;
  }
  const ignored = phoneE164 ? await isIgnoredNumber(whatsAppDigits(phoneE164)) : false;

  return {
    fileName: file.fileName,
    contactName: parsed.contactName,
    phoneE164,
    authors: parsed.authors,
    dayanaAuthor,
    messageCount: parsed.messages.length,
    firstAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    lastAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    candidates,
    isGroup: parsed.authors.length > 2,
    classification,
    decision: ignored ? "skip" : decideExport(classification),
    ignored,
  };
};

export const previewExportFiles = async (files: ExportTextFile[]): Promise<ExportFilePreview[]> => {
  const [timeZone, teamPhones] = await Promise.all([getOperationalTimezone(), getTeamPhones().catch(() => [])]);
  const out: ExportFilePreview[] = [];
  for (const file of files) {
    out.push(await previewOf(file, parseExportFile(file.fileName, file.text, timeZone), teamPhones));
  }
  return out;
};

export type ExportImportResult = {
  conversationId: string | null;
  threadId: string;
  /** Mensajes del archivo que se pueden guardar (sin borrados). */
  total: number;
  stored: number;
  /** Ya estaban de una importación anterior del mismo chat. */
  duplicates: number;
  /** Ya estaban en el CRM porque llegaron por WhatsApp en vivo. */
  alreadyInCrm: number;
};

export class ExportImportError extends Error {
  constructor(public code: "invalid_phone" | "no_messages" | "group_chat" | "ignored_number") {
    super(code);
  }
}

const CHUNK = 1000;
/** Diferencia de hora tolerada al comparar con lo que llegó en vivo (zonas horarias). */
const LIVE_MATCH_WINDOW_MS = 14 * 60 * 60 * 1000;
const LIVE_MEDIA_WINDOW_MS = 3 * 60 * 1000;

const sameText = (a: string | null, b: string | null) =>
  Boolean(a && b) && a!.replace(/\s+/g, " ").trim() === b!.replace(/\s+/g, " ").trim();

/**
 * Guarda un chat exportado como historial. Idempotente: subir el mismo archivo
 * otra vez (o una exportación más nueva del mismo chat) no duplica nada, y los
 * mensajes que ya llegaron en vivo por WhatsApp no se repiten.
 */
export const importExportChat = async (input: {
  text: string;
  fileName: string;
  phoneE164: string;
  dayanaAuthor: string | null;
  timeZone?: string;
}): Promise<ExportImportResult> => {
  const phone = normalizePhoneInput(input.phoneE164);
  if (!phone) throw new ExportImportError("invalid_phone");
  const parsed = parseExportFile(input.fileName, input.text, input.timeZone ?? (await getOperationalTimezone()));
  if (parsed.messages.length === 0) throw new ExportImportError("no_messages");
  if (parsed.authors.length > 2) throw new ExportImportError("group_chat");
  // Un número personal de Dayana no se sube, aunque alguien lo intente.
  if (await isIgnoredNumber(whatsAppDigits(phone))) throw new ExportImportError("ignored_number");

  const threadId = whatsAppDigits(phone);
  const legacyId = phone.replace(/\D/g, "");
  // Chats creados antes con el E.164 tal cual (México/Argentina): se pasan al
  // número de WhatsApp, igual que al enviar desde el CRM.
  if (legacyId !== threadId) {
    const [current, legacy] = await Promise.all([
      prisma.conversation.findUnique({
        where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: threadId } },
        select: { id: true },
      }),
      prisma.conversation.findUnique({
        where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: legacyId } },
        select: { id: true },
      }),
    ]);
    if (legacy && !current) {
      await prisma.conversation.update({ where: { id: legacy.id }, data: { externalThreadId: threadId } });
    }
  }

  const credentials = await resolveWhatsAppCredentials();
  const contactName = looksLikePhone(parsed.contactName) ? null : parsed.contactName || null;
  const dayanaAuthor = input.dayanaAuthor?.trim()
    ? detectDayanaAuthor(parsed.authors, { override: input.dayanaAuthor })
    : null;
  const events = toHistoryEvents({
    phoneE164: phone,
    contactName,
    dayanaAuthor,
    messages: parsed.messages,
    metaAccountId: credentials?.accountId ?? "unknown",
  });

  // 1. Lo que ya se importó antes (mismo id): se salta sin tocar la base.
  const known = new Set<string>();
  for (let i = 0; i < events.length; i += CHUNK) {
    const rows = await prisma.conversationMessage.findMany({
      where: { externalMessageId: { in: events.slice(i, i + CHUNK).map((e) => e.externalMessageId) } },
      select: { externalMessageId: true },
    });
    rows.forEach((r) => r.externalMessageId && known.add(r.externalMessageId));
  }

  // 2. Lo que ya llegó en vivo (desde que el número está conectado): mismo
  // sentido y mismo texto cerca de la misma hora. El archivo solo trae la hora
  // en minutos y en la zona del celular, así que se compara con margen.
  const existing = await prisma.conversation.findUnique({
    where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: threadId } },
    select: { id: true, participantName: true },
  });
  let live: { isEcho: boolean; body: string | null; sentAt: Date; hasMedia: boolean }[] = [];
  if (existing && events.length > 0) {
    const times = events.map((e) => e.sentAt.getTime());
    const rows = await prisma.conversationMessage.findMany({
      where: {
        conversationId: existing.id,
        NOT: { externalMessageId: { startsWith: "export:" } },
        sentAt: {
          gte: new Date(Math.min(...times) - LIVE_MATCH_WINDOW_MS),
          lte: new Date(Math.max(...times) + LIVE_MATCH_WINDOW_MS),
        },
      },
      select: { direction: true, body: true, sentAt: true, attachments: true },
    });
    live = rows.map((r) => ({
      isEcho: r.direction === "OUTBOUND",
      body: r.body,
      sentAt: r.sentAt,
      hasMedia: Array.isArray(r.attachments) && r.attachments.length > 0,
    }));
  }
  const inLive = (e: (typeof events)[number]) =>
    live.some((m) => {
      if (m.isEcho !== e.isEcho) return false;
      const gap = Math.abs(m.sentAt.getTime() - e.sentAt.getTime());
      if (e.system) return (m.hasMedia || !m.body) && gap <= LIVE_MEDIA_WINDOW_MS;
      return gap <= LIVE_MATCH_WINDOW_MS && sameText(m.body, e.body);
    });

  let duplicates = 0;
  let alreadyInCrm = 0;
  const fresh = events.filter((e) => {
    if (known.has(e.externalMessageId)) {
      duplicates++;
      return false;
    }
    if (inLive(e)) {
      alreadyInCrm++;
      return false;
    }
    return true;
  });

  const result = fresh.length
    ? await processHistoryEvents("whatsapp_business_account", fresh)
    : { stored: 0, conversations: 0 };

  const conversation = await prisma.conversation.findUnique({
    where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: threadId } },
    select: { id: true, participantName: true, contactId: true },
  });
  if (conversation && contactName && (!conversation.participantName || looksLikePhone(conversation.participantName))) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { participantName: contactName } });
  }
  if (conversation && !conversation.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { phoneE164: { in: contactPhoneCandidates(threadId) } },
      select: { id: true },
    });
    if (contact) await prisma.conversation.update({ where: { id: conversation.id }, data: { contactId: contact.id } });
  }

  return {
    conversationId: conversation?.id ?? null,
    threadId,
    total: events.length,
    stored: result.stored,
    duplicates: duplicates + (fresh.length - result.stored),
    alreadyInCrm,
  };
};
