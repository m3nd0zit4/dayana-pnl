import { NextResponse } from "next/server";

import { authorized } from "@/lib/cron-auth";
import { sendEventWhatsAppReminders } from "@/lib/crm/event-whatsapp-reminders";
import { closeDueFreeEvents, listLiveFreeEvents } from "@/lib/crm/free-webinar";
import { drainWebinarMail } from "@/lib/crm/webinar-mailer";
import { closeDueWorkshops, listLiveWorkshopEditions } from "@/lib/crm/workshop-lifecycle";
import { drainWorkshopReminders } from "@/lib/crm/workshop-reminders";
import { sendWorkshopWhatsAppReminders } from "@/lib/crm/workshop-whatsapp-reminders";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * El reloj de los eventos: lo llama GitHub Actions cada 10 minutos, después del
 * de WhatsApp (`.github/workflows/whatsapp-cron.yml`). Hace lo que hacían los
 * crons de Inngest, que en producción no corren: correos de los eventos
 * gratuitos (enlace y recordatorios), sus recordatorios por WhatsApp, los
 * recordatorios de los talleres (correo y WhatsApp) y el cierre de los eventos
 * y talleres que ya pasaron.
 *
 * Atiende a todos los eventos en pie (publicado o con inscripciones cerradas,
 * sin terminar): normalmente uno, dos si ya se publicó el siguiente antes de
 * que pase el actual — sus inscritas siguen recibiendo los avisos. Igual con
 * los talleres: quien pagó una edición cerrada sigue recibiendo los suyos.
 *
 * Si Inngest vuelve a correr no pasa nada: cada envío reclama su fila antes de
 * salir, así que dos relojes a la vez no mandan nada dos veces.
 *
 * Todo cabe en ~250 s (Vercel corta a los 300). Lo que no cabe se queda en la
 * cola y sale en el siguiente tick. Los de 1 h van primero: su ventana es la
 * única que no se recupera.
 */
const TOTAL_MS = 250_000;
/** Lo que se reserva para los correos de talleres y los cierres, que son rápidos. */
const TAIL_MS = 20_000;

const step = async <T,>(name: string, fn: () => Promise<T>) => {
  try {
    return { name, ok: true, result: await fn() };
  } catch (e) {
    console.error(`[reloj eventos] ${name}`, e);
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

type Pass = [string, () => Promise<unknown>];

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const deadline = Date.now() + TOTAL_MS;
  /** Presupuesto de un paso: su tope, sin comerse la reserva del final. */
  const budget = (cap: number) => Math.max(0, Math.min(cap, deadline - TAIL_MS - Date.now()));
  const steps: Awaited<ReturnType<typeof step>>[] = [];

  const live = await listLiveFreeEvents().catch(() => []);
  if (live.length === 0) {
    steps.push({ name: "evento", ok: true, result: { skipped: "sin evento en pie" } });
  }
  // Talleres en pie con fecha y enlace: los únicos a los que les toca WhatsApp.
  const liveWorkshops = (await listLiveWorkshopEditions().catch(() => [])).filter(
    (w) => w.startsAt && w.meetingUrl
  );
  // Con dos en pie, el nombre del paso dice de cuál es.
  const tag = (id: string) => (live.length > 1 ? ` · ${id.slice(-6)}` : "");
  const wtag = (id: string) => (liveWorkshops.length > 1 ? ` · ${id.slice(-6)}` : "");
  // Primero el de 1 h de todos (el que no se recupera), luego el resto.
  const passes: Pass[] = [
    ...live.flatMap((e): Pass[] => [
      [`correo 1h${tag(e.id)}`, () => drainWebinarMail("1h", budget(60_000), false, e.id)],
      [
        `whatsapp 1h${tag(e.id)}`,
        () => sendEventWhatsAppReminders({ pass: "1h", webinarId: e.id, budgetMs: budget(60_000) }),
      ],
    ]),
    ...liveWorkshops.map(
      (w): Pass => [
        `taller whatsapp 1h${wtag(w.id)}`,
        () => sendWorkshopWhatsAppReminders({ pass: "1h", editionId: w.id, budgetMs: budget(30_000) }),
      ]
    ),
    ...live.flatMap((e): Pass[] => [
      [`correo 24h${tag(e.id)}`, () => drainWebinarMail("24h", budget(50_000), false, e.id)],
      [
        `whatsapp 24h${tag(e.id)}`,
        () => sendEventWhatsAppReminders({ pass: "24h", webinarId: e.id, budgetMs: budget(50_000) }),
      ],
      [`correo enlace${tag(e.id)}`, () => drainWebinarMail("link", budget(30_000), false, e.id)],
    ]),
    ...liveWorkshops.map(
      (w): Pass => [
        `taller whatsapp 24h${wtag(w.id)}`,
        () => sendWorkshopWhatsAppReminders({ pass: "24h", editionId: w.id, budgetMs: budget(30_000) }),
      ]
    ),
  ];
  for (const [name, run] of passes) {
    if (budget(1) <= 0) {
      steps.push({ name, ok: true, result: { skipped: "sin tiempo" } });
      continue;
    }
    steps.push(await step(name, run));
  }

  steps.push(await step("taller 1h", () => drainWorkshopReminders("1h")));
  steps.push(await step("taller 24h", () => drainWorkshopReminders("24h")));

  // Al final, para que este mismo tick alcance a mandar el de 1 h. El aviso
  // sale solo si ESTE proceso selló `endedAt` (compare-and-swap sobre null):
  // si Inngest también corre, solo uno de los dos lo gana.
  steps.push(
    await step("cierre", async () => {
      const closed = await closeDueFreeEvents();
      for (const event of closed) {
        await emitPlatformNotification({
          eventType: "SYSTEM_ALERT",
          title: "El evento gratuito ya terminó",
          body: `«${event.headline}»: se cerraron los registros y los recordatorios. Mira su historia o prepara el siguiente.`,
          href: `/admin/eventos/${event.id}?tab=historia`,
          entityType: "FreeWebinar",
          entityId: event.id,
          staff: "ALL",
        }).catch(() => undefined);
      }
      return { closed: closed.map((e) => e.id) };
    })
  );
  steps.push(
    await step("cierre talleres", async () => {
      const closed = await closeDueWorkshops();
      for (const w of closed) {
        await emitPlatformNotification({
          eventType: "SYSTEM_ALERT",
          title: "El taller ya terminó",
          body: `«${w.title}»: se cerraron las ventas y los recordatorios. Mira su historia o prepara la siguiente edición.`,
          href: `/admin/workshops/${encodeURIComponent(w.slug)}?tab=historia`,
          entityType: "WorkshopEdition",
          entityId: w.id,
          staff: "ALL",
        }).catch(() => undefined);
      }
      return { closed: closed.map((w) => w.id) };
    })
  );

  console.info(`[reloj eventos] ${JSON.stringify(steps)}`);
  return NextResponse.json({ ok: steps.every((s) => s.ok), steps });
}
