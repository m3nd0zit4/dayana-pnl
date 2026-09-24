import { NextResponse, type NextRequest } from "next/server";
import { fireAuditLog } from "@/lib/crm/audit";
import { acceptMetaEvents, describeWebhook } from "@/lib/meta/dispatch";
import { normalizeMetaPayload } from "@/lib/meta/inbound";
import {
  resolveMetaSubscription,
  verifyMetaWebhook,
} from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La IA de WhatsApp contesta dentro de esta invocación (tras responder), y
// el historial de la app (coexistencia) se procesa tras responder y puede
// ser largo.
export const maxDuration = 300;

/**
 * Endpoint único de los webhooks de Meta: WhatsApp, Messenger e Instagram.
 *
 * Los tres canales viven en la misma app de Meta y comparten URL de callback;
 * el campo `object` del cuerpo distingue de cuál viene cada aviso.
 */

/** Handshake de suscripción: Meta pide que le devolvamos su `hub.challenge`. */
export async function GET(req: NextRequest) {
  const challenge = resolveMetaSubscription(req);
  if (!challenge) {
    return NextResponse.json({ error: "verification_failed" }, { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  // El cuerpo crudo se lee una sola vez: la firma es un HMAC sobre estos bytes
  // exactos, así que volver a serializar el JSON la invalidaría.
  const rawBody = await req.text();

  if (!verifyMetaWebhook(req, rawBody)) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "MetaWebhookEvent",
      entityId: "meta",
      changes: { reason: "invalid_signature" },
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const events = normalizeMetaPayload(payload);
  console.info(`[webhook meta] ${describeWebhook(payload, events)}`);

  // Se responde 200 aunque no haya nada que hacer. Meta reintenta ante
  // cualquier cosa que no sea 200 y un reintento en bucle sobre un payload que
  // no entendemos es peor que ignorarlo.
  if (events.length === 0) {
    return NextResponse.json({ ok: true, queued: 0 });
  }

  const object =
    typeof payload === "object" && payload !== null
      ? String((payload as { object?: unknown }).object ?? "unknown")
      : "unknown";

  try {
    const counts = await acceptMetaEvents({ source: "meta", object, raw: payload, events });
    return NextResponse.json({ ok: true, ...counts });
  } catch (e) {
    console.error("[webhook meta] no se pudo guardar el aviso", e);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
}
