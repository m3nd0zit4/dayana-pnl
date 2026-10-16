import { NextResponse } from "next/server";

import { authorized } from "@/lib/cron-auth";
import { runEventsClock } from "@/lib/crm/events-clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * El reloj de los eventos: lo llama GitHub Actions cada 10 minutos, después del
 * de WhatsApp (`.github/workflows/whatsapp-cron.yml`). Lo que hace está en
 * `runEventsClock` (`lib/crm/events-clock.ts`), que también corre con el reloj
 * pegado a los avisos de WhatsApp (`tick.ts`) mientras no haya `CRON_SECRET`.
 *
 * Todo cabe en ~250 s (Vercel corta a los 300). Lo que no cabe se queda en la
 * cola y sale en el siguiente tick.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const steps = await runEventsClock({ totalMs: 250_000 });
  console.info(`[reloj eventos] ${JSON.stringify(steps)}`);
  return NextResponse.json({ ok: steps.every((s) => s.ok), steps });
}
