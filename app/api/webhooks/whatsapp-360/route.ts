import { timingSafeEqual } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";

import { fireAuditLog } from "@/lib/crm/audit";
import { emitMetaWebhook } from "@/lib/inngest/events";
import { normalizeMetaPayload, threadKeyOf } from "@/lib/meta/inbound";
import { getDialog360WebhookSecret } from "@/lib/meta/whatsapp-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Avisos de WhatsApp que llegan por 360dialog (coexistencia).
 *
 * El cuerpo es el mismo de la Cloud API de Meta, así que después de validar
 * el origen se procesa exactamente igual que `/api/webhooks/meta`: misma
 * normalización, misma cola, misma bandeja.
 *
 * Lo que cambia es la prueba de origen. 360dialog no firma los avisos de un
 * cliente directo como hace Meta; en su lugar manda en la cabecera
 * `X-Webhook-Secret` el secreto que el CRM generó al registrar esta URL. Sin
 * esa cabecera, o con otra, el aviso se rechaza: esta ruta es pública y sin
 * esto cualquiera podría meter mensajes falsos en la bandeja.
 */

const sameSecret = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export async function POST(req: NextRequest) {
  const expected = await getDialog360WebhookSecret();
  const received = req.headers.get("x-webhook-secret") ?? "";

  if (!expected || !received || !sameSecret(received, expected)) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "MetaWebhookEvent",
      entityId: "whatsapp-360",
      changes: { reason: expected ? "invalid_secret" : "not_registered" },
    });
    return NextResponse.json({ error: "invalid_secret" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const events = normalizeMetaPayload(payload);
  if (events.length === 0) {
    return NextResponse.json({ ok: true, queued: 0 });
  }

  const object =
    typeof payload === "object" && payload !== null
      ? String((payload as { object?: unknown }).object ?? "whatsapp_business_account")
      : "whatsapp_business_account";

  const queued = await Promise.all(
    events.map((event) =>
      emitMetaWebhook({ object, threadKey: threadKeyOf(event), event })
    )
  );

  // Mismo respaldo que la ruta de Meta: lo que no se pudo encolar se procesa
  // en línea después de responder, para que 360dialog no reintente.
  const pending = events.filter((_, i) => !queued[i]);
  if (pending.length > 0) {
    after(async () => {
      const { processNormalizedEvent } = await import("@/lib/meta/ingest");
      for (const event of pending) {
        try {
          await processNormalizedEvent(object, event);
        } catch (e) {
          console.error("[webhook 360dialog] inline processing failed", e);
        }
      }
    });
  }

  return NextResponse.json({
    ok: true,
    queued: queued.filter(Boolean).length,
    inline: pending.length,
  });
}
