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
