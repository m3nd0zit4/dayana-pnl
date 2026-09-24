import { NextResponse } from "next/server";

import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  isWhatsAppWorkspaceAvailable,
  workspaceSnapshot,
} from "@/lib/crm/whatsapp-agent/workspace";
import { createFeedStream, SSE_HEADERS } from "@/lib/notifications/platform/stream";
import { kickSweep } from "@/lib/meta/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Stream de la sección de WhatsApp: avisa cuando entra un mensaje o la IA
 * avanza un paso (en cola → pensando → enviando → respondió). Mismo mecanismo
 * que el de la bandeja (`createFeedStream`), con su relevo a los 285 s.
 */
export const GET = async (req: Request) => {
  if (!(await isWhatsAppWorkspaceAvailable())) {
    return NextResponse.json({ error: "whatsapp_disabled" }, { status: 404 });
  }
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  // Mientras alguien mira WhatsApp, cada ~30 s se barre la cola de entrada:
  // lo que falló se reintenta aunque no lleguen avisos nuevos.
  let lastSweep = 0;
  const stream = createFeedStream({
    poll: () => {
      if (Date.now() - lastSweep > 30_000) {
        lastSweep = Date.now();
        void kickSweep().catch((e) => console.warn("[cola WhatsApp] barrido", e));
      }
      return workspaceSnapshot();
    },
    signal: req.signal,
    intervalMs: 2000,
    lastEventId: req.headers.get("last-event-id") ?? undefined,
  });
  return new Response(stream, { headers: SSE_HEADERS });
};
