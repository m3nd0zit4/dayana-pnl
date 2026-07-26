import { after, NextResponse, type NextRequest } from "next/server";
import { fireAuditLog } from "@/lib/crm/audit";
import { emitMetaWebhook } from "@/lib/inngest/events";
import { normalizeMetaPayload, threadKeyOf } from "@/lib/meta/inbound";
import {
  resolveMetaSubscription,
  verifyMetaWebhook,
} from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // El trabajo real se hace en Inngest: da reintentos duraderos y, sobre todo,
  // serializa por hilo, que es lo que evita que tres mensajes seguidos del
  // mismo cliente se guarden desordenados.
  const queued = await Promise.all(
    events.map((event) =>
      emitMetaWebhook({
        object,
        threadKey: threadKeyOf(event),
        event,
      })
    )
  );

  // Respaldo en línea de lo que no se pudo encolar. `after()` mantiene viva la
  // invocación tras responder, que es lo que Meta necesita: acuse rápido y el
  // trabajo terminado igualmente.
  const pending = events.filter((_, i) => !queued[i]);
  if (pending.length > 0) {
    after(async () => {
      const { processNormalizedEvent } = await import("@/lib/meta/ingest");
      for (const event of pending) {
        try {
          await processNormalizedEvent(object, event);
        } catch (e) {
          console.error("[webhook meta] inline processing failed", e);
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
