import { NextResponse } from "next/server";

import { authorized } from "@/lib/cron-auth";
import { kickSweep } from "@/lib/meta/inbox";
import { classifyFromCron } from "@/lib/crm/chat-category";
import { sendDueReminders, syncAppointments } from "@/lib/crm/whatsapp-agent/appointments";
import { refreshTemplatesIfPending } from "@/lib/crm/whatsapp-templates";

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

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const steps = [
    await step("citas", () => syncAppointments()),
    await step("recordatorios", () => sendDueReminders()),
    await step("cola", () => kickSweep()),
    await step("plantillas", () => refreshTemplatesIfPending()),
    await step("clasificar", () =>
      classifyFromCron(Math.min(CLASSIFY_MAX_MS, CLASSIFY_DEADLINE_MS - (Date.now() - started)))
    ),
  ];
  console.info(`[reloj WhatsApp] ${JSON.stringify(steps)}`);
  return NextResponse.json({ ok: steps.every((s) => s.ok), steps });
}
