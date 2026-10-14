import { NextResponse } from "next/server";

import { authorized } from "@/lib/cron-auth";
import { kickSweep } from "@/lib/meta/inbox";
import { classifyFromCron } from "@/lib/crm/chat-category";
import { areRemindersEnabled, sendDueReminders, syncAppointments } from "@/lib/crm/whatsapp-agent/appointments";
import { refreshTemplatesIfPending } from "@/lib/crm/whatsapp-templates";
import { refreshStaleDossiers } from "@/lib/crm/whatsapp-agent/dossier";
import { refreshStages } from "@/lib/crm/whatsapp-agent/segment-store";
import { sweepWaitingRoom } from "@/lib/crm/whatsapp-agent/waiting-room";
import { sweepCallOutcomes } from "@/lib/crm/whatsapp-agent/call-outcome";
import { answerUnansweredChats } from "@/lib/crm/whatsapp-agent/catch-up";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * El reloj de WhatsApp: lo llama GitHub Actions cada 10 minutos
 * (`.github/workflows/whatsapp-cron.yml`). No hay cron en Vercel ni Inngest
 * que funcione, y los recordatorios no pueden depender de que alguien tenga el
 * CRM abierto.
 *
 * Cada paso va aparte: si el calendario falla, la cola y los recordatorios
 * siguen.
 */
const step = async <T,>(name: string, fn: () => Promise<T>) => {
  try {
    return { name, ok: true, result: await fn() };
  } catch (e) {
    console.error(`[reloj WhatsApp] ${name}`, e);
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Clasificar chats va al final y solo con el tiempo que sobra: como mucho
 * 40 s y nunca más allá de los 80 s del reloj (la llamada a la IA en curso
 * también corta ahí), para que la ruta termine antes de ~90 s (límite 120).
 */
const CLASSIFY_MAX_MS = 40_000;
const CLASSIFY_DEADLINE_MS = 80_000;
/** Fichas viejas o que faltan: hasta 25 s por vuelta (solo con la ficha encendida). */
const DOSSIER_MAX_MS = 25_000;
/** Estados de las personas (sin modelo, solo consultas): hasta 10 s por vuelta. */
const STAGES_MAX_MS = 10_000;

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  // Chats que llevan más de 10 min sin respuesta (pausas, fallos): corre a la
  // par del resto de pasos, con lo que dé el reloj.
  const pending = step("pendientes", () => answerUnansweredChats({ budgetMs: 100_000, minAgeMin: 10, recentRunMin: 60, limit: 8, concurrency: 4 }));
  const steps = [
    await step("citas", () => syncAppointments()),
    await step("recordatorios", async () => ((await areRemindersEnabled()) ? sendDueReminders() : { off: true })),
    await step("cola", () => kickSweep()),
    await step("sala de espera", async () => sweepWaitingRoom(await getWhatsAppAiConfig())),
    await step("seguimiento llamadas", async () => sweepCallOutcomes(await getWhatsAppAiConfig())),
    await step("plantillas", () => refreshTemplatesIfPending()),
    await step("fichas", async () =>
      (await getWhatsAppAiConfig()).dossier.enabled ? refreshStaleDossiers(DOSSIER_MAX_MS, { limit: 15 }) : { off: true }
    ),
    await step("estados", async () => {
      const c = await getWhatsAppAiConfig();
      return c.dossier.enabled || c.router.enabled ? refreshStages(STAGES_MAX_MS, { limit: 60 }) : { off: true };
    }),
    await step("clasificar", () =>
      classifyFromCron(Math.min(CLASSIFY_MAX_MS, CLASSIFY_DEADLINE_MS - (Date.now() - started)))
    ),
  ];
  const all = [...steps, await pending];
  console.info(`[reloj WhatsApp] ${JSON.stringify(all)}`);
  return NextResponse.json({ ok: all.every((s) => s.ok), steps: all });
}
