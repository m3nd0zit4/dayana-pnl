import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { kickSweep } from "@/lib/meta/inbox";
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
const authorized = (req: Request): boolean => {
  const secret = process.env.CRON_SECRET?.trim();
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !got) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
};

const step = async <T,>(name: string, fn: () => Promise<T>) => {
  try {
    return { name, ok: true, result: await fn() };
  } catch (e) {
    console.error(`[reloj WhatsApp] ${name}`, e);
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const steps = [
    await step("citas", () => syncAppointments()),
    await step("recordatorios", () => sendDueReminders()),
    await step("cola", () => kickSweep()),
    await step("plantillas", () => refreshTemplatesIfPending()),
  ];
  console.info(`[reloj WhatsApp] ${JSON.stringify(steps)}`);
  return NextResponse.json({ ok: steps.every((s) => s.ok), steps });
}
