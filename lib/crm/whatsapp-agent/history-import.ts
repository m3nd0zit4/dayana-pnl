import { get, list, put } from "@vercel/blob";
import { strFromU8, unzipSync } from "fflate";

import { normalizeMetaPayload, type NormalizedEvent } from "@/lib/meta/inbound";
import { getSiteSetting, setSiteSetting } from "../site-settings";

/**
 * Importar el historial de chats que se descarga del Hub de 360dialog.
 *
 * Para clientes directos de 360dialog (como Dayana) el historial de la app no
 * llega por webhook: se sincroniza y se descarga desde el Hub. El archivo trae
 * lo mismo que el webhook `history` de Meta, así que se pasa por el mismo
 * lector (`normalizeMetaPayload`) y por el mismo proceso
 * (`processHistoryEvents`), que guarda los chats, aprende de las respuestas de
 * Dayana y escribe su guía de estilo.
 *
 * El archivo sube por partes (el límite de un pedido en Vercel es ~4,5 MB) y
 * se guarda privado en Blob mientras se procesa.
 */

const STATUS_KEY = "whatsapp.historyImport";

export type HistoryImportStatus = {
  status: "idle" | "uploading" | "processing" | "done" | "error";
  file?: string;
  events?: number;
  stored?: number;
  conversations?: number;
  error?: string;
  at: string;
};

export const getHistoryImportStatus = async (): Promise<HistoryImportStatus> => {
  const raw = await getSiteSetting(STATUS_KEY);
  try {
    return raw ? (JSON.parse(raw) as HistoryImportStatus) : { status: "idle", at: new Date(0).toISOString() };
  } catch {
    return { status: "idle", at: new Date(0).toISOString() };
  }
};

const setStatus = (status: Omit<HistoryImportStatus, "at">) =>
  setSiteSetting(STATUS_KEY, JSON.stringify({ ...status, at: new Date().toISOString() }));

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** El texto de un archivo → los objetos JSON que trae (uno, una lista o uno por línea). */
export const parseHistoryText = (text: string): unknown[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  }
};

const wrapHistoryValue = (value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "hub-import", changes: [{ field: "history", value }] }],
});

/**
 * Convierte lo que venga en el archivo en eventos. Acepta el aviso completo de
 * Meta, solo su `value` (con `history`), un trozo (`threads`) o un hilo suelto
 * (`id` + `messages`).
 */
export const historyEventsFrom = (items: unknown[]): NormalizedEvent[] => {
  const events: NormalizedEvent[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!isRecord(item)) return;
    const direct = normalizeMetaPayload(item);
    if (direct.length > 0) {
      events.push(...direct);
      return;
    }
    if (Array.isArray(item.history)) {
      events.push(...normalizeMetaPayload(wrapHistoryValue(item)));
    } else if (Array.isArray(item.threads)) {
      events.push(...normalizeMetaPayload(wrapHistoryValue({ history: [item] })));
    } else if (typeof item.id === "string" && Array.isArray(item.messages)) {
      events.push(...normalizeMetaPayload(wrapHistoryValue({ history: [{ threads: [item] }] })));
    } else if (Array.isArray(item.data) || isRecord(item.data)) {
      visit(item.data);
    }
  };
  items.forEach(visit);
  // Todo lo que viene del archivo es pasado: no avisa, no saluda, no contesta.
  return events.map((e) => (e.kind === "message" ? { ...e, isHistory: true } : e));
};

/** Los textos dentro del archivo (un .json, un .ndjson o un .zip con varios). */
export const filesFromUpload = (name: string, bytes: Uint8Array): string[] => {
  if (/\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const entries = unzipSync(bytes);
    return Object.entries(entries)
      .filter(([file]) => /\.(json|ndjson|jsonl|txt)$/i.test(file) && !file.startsWith("__MACOSX"))
      .map(([, data]) => strFromU8(data));
  }
  return [strFromU8(bytes)];
};

const PART_PREFIX = "inbox/history/";

export const saveHistoryPart = async (uploadId: string, index: number, chunk: ArrayBuffer) => {
  await put(`${PART_PREFIX}${uploadId}/part-${String(index).padStart(5, "0")}`, chunk, {
    access: "private",
    contentType: "application/octet-stream",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
};

const readParts = async (uploadId: string): Promise<Uint8Array> => {
  const { blobs } = await list({ prefix: `${PART_PREFIX}${uploadId}/`, limit: 1000 });
  const ordered = blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
  const buffers: Uint8Array[] = [];
  for (const blob of ordered) {
    const result = await get(blob.pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error("No se pudo leer una parte del archivo.");
    buffers.push(new Uint8Array(await new Response(result.stream).arrayBuffer()));
  }
  const total = buffers.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
};

/** Procesa un historial ya subido por partes. Nunca lanza: deja el estado. */
export const processHistoryUpload = async (uploadId: string, fileName: string): Promise<void> => {
  try {
    await setStatus({ status: "processing", file: fileName });
    const bytes = await readParts(uploadId);
    const texts = filesFromUpload(fileName, bytes);
    const events = historyEventsFrom(texts.flatMap(parseHistoryText));
    if (events.length === 0) {
      await setStatus({
        status: "error",
        file: fileName,
        events: 0,
        error:
          "El archivo no trae mensajes que se puedan leer. Descárgalo de nuevo desde el Hub de 360dialog (historial de coexistencia) y súbelo sin cambiarlo.",
      });
      return;
    }
    const { processHistoryEvents } = await import("@/lib/meta/ingest");
    const result = await processHistoryEvents("whatsapp_business_account", events);
    await setStatus({
      status: "done",
      file: fileName,
      events: events.length,
      stored: result.stored,
      conversations: result.conversations,
    });
  } catch (e) {
    console.error("[historial 360] no se pudo importar", e);
    await setStatus({
      status: "error",
      file: fileName,
      error: e instanceof Error ? e.message : "Error al procesar el archivo.",
    });
  }
};
