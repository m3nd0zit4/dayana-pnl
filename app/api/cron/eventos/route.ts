import { NextResponse } from "next/server";

import { authorized } from "@/lib/cron-auth";
import { sendEventWhatsAppReminders } from "@/lib/crm/event-whatsapp-reminders";
import { closeFreeWebinarIfDue, getFreeWebinar } from "@/lib/crm/free-webinar";
import { drainWebinarMail } from "@/lib/crm/webinar-mailer";
import { drainWorkshopReminders } from "@/lib/crm/workshop-reminders";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * El reloj de los eventos: lo llama GitHub Actions cada 10 minutos, después del
 * de WhatsApp (`.github/workflows/whatsapp-cron.yml`). Hace lo que hacían los
 * crons de Inngest, que en producción no corren: correos del evento gratuito
 * (enlace y recordatorios), sus recordatorios por WhatsApp, los recordatorios
 * de los talleres y el cierre del evento cuando ya pasó.
 *
 * Si Inngest vuelve a correr no pasa nada: cada envío reclama su fila antes de
 * salir, así que dos relojes a la vez no mandan nada dos veces.
 *
 * Todo cabe en ~250 s (Vercel corta a los 300). Lo que no cabe se queda en la
 * cola y sale en el siguiente tick. El de 1 h va primero: su ventana es la
 * única que no se recupera.
 */
const TOTAL_MS = 250_000;
/** Lo que se reserva para talleres y cierre, que son rápidos. */
const TAIL_MS = 20_000;

const step = async <T,>(name: string, fn: () => Promise<T>) => {
  try {
    return { name, ok: true, result: await fn() };
  } catch (e) {
    console.error(`[reloj eventos] ${name}`, e);
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const deadline = Date.now() + TOTAL_MS;
  /** Presupuesto de un paso: su tope, sin comerse la reserva del final. */
  const budget = (cap: number) => Math.max(0, Math.min(cap, deadline - TAIL_MS - Date.now()));
  const steps: Awaited<ReturnType<typeof step>>[] = [];

  const live = await getFreeWebinar().catch(() => null);
  if (live && !live.endedAt) {
    const passes: [string, () => Promise<unknown>][] = [
      ["correo 1h", () => drainWebinarMail("1h", budget(60_000))],
      ["whatsapp 1h", () => sendEventWhatsAppReminders({ pass: "1h", budgetMs: budget(60_000) })],
      ["correo 24h", () => drainWebinarMail("24h", budget(50_000))],
      ["whatsapp 24h", () => sendEventWhatsAppReminders({ pass: "24h", budgetMs: budget(50_000) })],
      ["correo enlace", () => drainWebinarMail("link", budget(30_000))],
    ];
    for (const [name, run] of passes) {
      if (budget(1) <= 0) {
        steps.push({ name, ok: true, result: { skipped: "sin tiempo" } });
        continue;
      }
      steps.push(await step(name, run));
    }
  } else {
    steps.push({ name: "evento", ok: true, result: { skipped: live ? "terminado" : "sin evento" } });
  }

  steps.push(await step("taller 1h", () => drainWorkshopReminders("1h")));
  steps.push(await step("taller 24h", () => drainWorkshopReminders("24h")));

  // Al final, para que este mismo tick alcance a mandar el de 1 h. El aviso
  // sale solo si ESTE proceso selló `endedAt` (compare-and-swap sobre null):
  // si Inngest también corre, solo uno de los dos lo gana.
  steps.push(
    await step("cierre", async () => {
      const closed = await closeFreeWebinarIfDue();
      if (closed.closed) {
        await emitPlatformNotification({
          eventType: "SYSTEM_ALERT",
          title: "El evento gratuito ya terminó",
          body: "Se cerraron los registros y los recordatorios. Puedes archivarlo para dejar lista la próxima edición.",
          href: "/admin/eventos",
          entityType: "FreeWebinar",
          entityId: closed.webinar.id,
          staff: "ALL",
        }).catch(() => undefined);
        return { closed: true };
      }
      return closed;
    })
  );

  console.info(`[reloj eventos] ${JSON.stringify(steps)}`);
  return NextResponse.json({ ok: steps.every((s) => s.ok), steps });
}
