import { after } from "next/server";

import { isBulkSyncEvent, type NormalizedEvent } from "./inbound";

/**
 * Procesa lo que llegó por un webhook de Meta o de 360dialog, después de
 * responder.
 *
 * Antes cada evento se mandaba a Inngest y se procesaba cuando Inngest volvía a
 * llamar a `/api/inngest`. En producción esa llamada de vuelta falló (500 y
 * luego silencio) y los mensajes se perdieron sin dejar rastro: 121 avisos de
 * WhatsApp respondidos con 200 y ni una conversación guardada. Un mensaje de un
 * cliente no puede depender de un tercero que llama de vuelta, así que ahora se
 * procesa aquí mismo con `after()`: la respuesta sale rápido (Meta y 360dialog
 * solo esperan el 200) y la invocación sigue viva hasta terminar.
 *
 * El orden dentro del mismo aviso se respeta (en serie). Entre avisos distintos
 * lo protege la deduplicación por id de mensaje y, para la IA, el ejecutor
 * (`lib/crm/whatsapp-agent/run.ts`), que espera a que la persona deje de
 * escribir y toma un candado por conversación.
 */
const mask = (id: string) => (id.length > 4 ? `…${id.slice(-4)}` : id);

/**
 * Una línea por aviso en los logs de Vercel: qué llegó (campos, tipos de
 * mensaje, hilos con los últimos 4 dígitos). Es lo que permite responder
 * «me escribió alguien y no aparece» mirando los logs en vez de adivinar.
 */
export const describeWebhook = (payload: unknown, events: NormalizedEvent[]): string => {
  const fields = new Set<string>();
  const types = new Set<string>();
  const entries = (payload as { entry?: { changes?: { field?: string; value?: { messages?: { type?: string }[] } }[] }[] })?.entry ?? [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      if (c.field) fields.add(c.field);
      for (const m of c.value?.messages ?? []) if (m.type) types.add(m.type);
    }
  }
  const kinds: Record<string, number> = {};
  const threads = new Set<string>();
  for (const ev of events) {
    kinds[ev.kind] = (kinds[ev.kind] ?? 0) + 1;
    if (ev.kind === "message") threads.add(mask(ev.threadId));
  }
  return `fields=${[...fields].join(",") || "-"} types=${[...types].join(",") || "-"} events=${JSON.stringify(kinds)} threads=${[...threads].join(",") || "-"}`;
};

/**
 * Un aviso que no se convirtió en nada se guarda tal cual (con los textos
 * recortados) para poder ver qué forma tenía y arreglar el lector.
 */
export const keepUnparsedPayload = async (payload: unknown): Promise<void> => {
  const trimmed = JSON.parse(
    JSON.stringify(payload, (key, value) =>
      key === "body" && typeof value === "string" ? value.slice(0, 40) : value
    )
  );
  const { prisma } = await import("@/lib/db");
  await prisma.metaWebhookEvent
    .create({
      data: {
        object: "unparsed",
        eventId: `unparsed:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        payload: trimmed,
      },
    })
    .catch((e: unknown) => console.warn("[webhook] no se pudo guardar el aviso sin leer", e));
};

let backfillStarted = false;

/**
 * Los audios que llegaron antes de que existiera la transcripción se pasan a
 * texto poco a poco, aprovechando los avisos que ya están corriendo (una tanda
 * por instancia y como mucho cada 10 minutos).
 */
const backfillAudioOnce = async () => {
  if (backfillStarted) return;
  backfillStarted = true;
  try {
    const { getSiteSetting, setSiteSetting } = await import("@/lib/crm/site-settings");
    const last = Number(await getSiteSetting("whatsapp.audioBackfillAt")) || 0;
    if (Date.now() - last < 10 * 60_000) return;
    await setSiteSetting("whatsapp.audioBackfillAt", String(Date.now()));
    const { transcribePendingAudio } = await import("@/lib/crm/whatsapp-agent/transcribe");
    const done = await transcribePendingAudio({ limit: 25 });
    if (done > 0) console.info(`[transcripción] ${done} audios pasados a texto`);
  } catch (e) {
    console.warn("[transcripción] tanda pendiente falló", e);
  }
};

export const dispatchMetaEvents = (
  object: string,
  events: NormalizedEvent[],
  source: string
): { live: number; bulk: number } => {
  const bulk = events.filter(isBulkSyncEvent);
  const live = events.filter((event) => !isBulkSyncEvent(event));

  after(async () => {
    const { processNormalizedEvent, processHistoryEvents } = await import(
      "./ingest"
    );
    await backfillAudioOnce();
    for (const event of live) {
      try {
        await processNormalizedEvent(object, event);
      } catch (e) {
        console.error(`[webhook ${source}] no se pudo procesar un evento`, e);
      }
    }
    // El historial va después: no tiene prisa y puede ser largo.
    if (bulk.length > 0) {
      try {
        await processHistoryEvents(object, bulk);
      } catch (e) {
        console.error(`[webhook ${source}] historial incompleto`, e);
      }
    }
  });

  return { live: live.length, bulk: bulk.length };
};
