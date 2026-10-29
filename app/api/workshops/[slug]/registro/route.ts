import { NextRequest, NextResponse, after } from "next/server";

import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { loadRegistrationEdition, registerWorkshopInterest, sendWorkshopRegistrationWhatsApp } from "@/lib/crm/workshop-registration";
import { parseRegistrationBody } from "@/lib/crm/workshop-registration-rules";
import { fireNotification } from "@/lib/notifications/platform/emit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * El formulario de `/taller-virtual/<slug>/registro` (dueña, 28-oct: «la gente
 * que oprime ahí en taller se registra y se clasifica como interesada»).
 * Registrarse es gratis y no da acceso: deja el contacto, la fila en
 * «Interesadas» y, después de responder, el WhatsApp de la asistente
 * (`sendWorkshopRegistrationWhatsApp`, con sus topes y silencios). Trampa para
 * bots y límite por IP como `/api/leads`.
 */

/** `after()` dentro de una petición; fuera (una prueba que llama a la ruta) lanza, y ahí se espera en línea. */
const afterResponse = async (task: () => Promise<void>): Promise<void> => {
  try {
    after(task);
  } catch {
    await task();
  }
};

export async function POST(req: NextRequest, ctx: Ctx) {
  const rl = await rateLimitDistributed(`taller-registro:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseRegistrationBody(body);
  if (!parsed.ok) {
    // Un bot que rellenó la trampa recibe un «listo» normal: ni contacto, ni fila, ni WhatsApp.
    if (parsed.error === "honeypot") {
      console.warn("[taller-registro] trampa de bots rellenada; se ignora");
      return NextResponse.json({ ok: true, alreadyEnrolled: false, alreadyRegistered: false });
    }
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { slug } = await ctx.params;
  const edition = await loadRegistrationEdition(decodeURIComponent(slug).slice(0, 120));
  if (!edition) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Un formulario abierto desde antes de que cerraran las inscripciones.
  if (!edition.open) return NextResponse.json({ error: "closed" }, { status: 409 });

  const input = parsed.value;
  try {
    const result = await registerWorkshopInterest(edition, input);
    if (result.status === "registered") {
      const { interestId, contactId, firstName, alreadyRegistered, phoneE164 } = result;
      // El WhatsApp, fuera de la petición: la persona ya tiene su «listo». Una sola vez por persona y edición.
      if (!alreadyRegistered) {
        await afterResponse(async () => {
          await sendWorkshopRegistrationWhatsApp({ editionId: edition.id, interestId, contactId, firstName }).catch((e) =>
            console.error("[taller-registro] WhatsApp del registro", e)
          );
        });
      }
      fireNotification({
        eventType: "WEB_LEAD_SUBMITTED",
        title: `${alreadyRegistered ? "Otra vez en" : "Interés en"} el taller: ${[input.firstName, input.lastName].filter(Boolean).join(" ")}`,
        body: [phoneE164, input.email, `«${edition.title}»`, "se registró en la página"].filter(Boolean).join(" · "),
        href: `/admin/workshops/${encodeURIComponent(edition.slug)}?tab=interesadas`,
        entityType: "Contact",
        entityId: contactId,
        metadata: { source: "taller_registro", workshopEditionId: edition.id, ref: input.ref, alreadyRegistered },
        staff: "ALL",
      });
      return NextResponse.json({ ok: true, alreadyEnrolled: false, alreadyRegistered });
    }
    return NextResponse.json({ ok: true, alreadyEnrolled: result.status === "enrolled", alreadyRegistered: false });
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_PHONE") {
      return NextResponse.json({ error: "invalid_phone", message: "Número de teléfono inválido" }, { status: 400 });
    }
    console.error("[taller-registro]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
