import { timingSafeEqual } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";

import { fireAuditLog } from "@/lib/crm/audit";
import {
  describeWebhook,
  dispatchMetaEvents,
  keepUnparsedPayload,
} from "@/lib/meta/dispatch";
import { normalizeMetaPayload } from "@/lib/meta/inbound";
import { getDialog360WebhookSecrets } from "@/lib/meta/whatsapp-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El historial de la app (coexistencia) se procesa tras responder y puede
// ser largo.
export const maxDuration = 300;

/**
 * Avisos de WhatsApp que llegan por 360dialog (coexistencia).
 *
 * El cuerpo es el mismo de la Cloud API de Meta, así que después de validar
 * el origen se procesa exactamente igual que `/api/webhooks/meta`: misma
 * normalización, mismo procesamiento (`lib/meta/dispatch.ts`), misma bandeja.
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
  const secrets = await getDialog360WebhookSecrets();
  const expected = secrets[0] ?? null;
  const received = req.headers.get("x-webhook-secret") ?? "";

  if (!expected || !received || !secrets.some((secret) => sameSecret(received, secret))) {
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
  console.info(`[webhook 360dialog] ${describeWebhook(payload, events)}`);
  if (events.length === 0) {
    after(() => keepUnparsedPayload(payload));
    return NextResponse.json({ ok: true, queued: 0 });
  }

  const object =
    typeof payload === "object" && payload !== null
      ? String((payload as { object?: unknown }).object ?? "whatsapp_business_account")
      : "whatsapp_business_account";

  const counts = dispatchMetaEvents(object, events, "360dialog");

  return NextResponse.json({ ok: true, ...counts });
}
