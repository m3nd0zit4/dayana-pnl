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
 * (`sendWorkshopRegistrationWhatsApp`, con sus topes —también por conexión— y
 * silencios). Trampa para bots y límite por IP como `/api/leads`.
 *
 * La respuesta es la misma para todos (revisión 28-oct): nunca dice si ese
 * número o ese correo ya pagó o ya estaba registrado.
 */

const OK = { ok: true } as const;

/** `after()` dentro de una petición; fuera (una prueba que llama a la ruta) lanza, y ahí se espera en línea. */
const afterResponse = async (task: () => Promise<void>): Promise<void> => {
  try {
    after(task);
  } catch {
    await task();
  }
};

export async function POST(req: NextRequest, ctx: Ctx) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`taller-registro:${ip}`, 10, 60_000);
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
      return NextResponse.json(OK);
    }
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Next ya decodifica el parámetro.
  const { slug } = await ctx.params;
  const edition = await loadRegistrationEdition(slug.slice(0, 120));
  if (!edition) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Un formulario abierto desde antes de que cerraran las inscripciones (o empezó el taller).
  if (!edition.open) return NextResponse.json({ error: "closed" }, { status: 409 });

  const input = parsed.value;
  try {
    const result = await registerWorkshopInterest(edition, input);
    if (result.status === "registered") {
      const { interestId, contactId, firstName, alreadyRegistered, phoneE164 } = result;
      // El WhatsApp, fuera de la petición. También en un registro repetido: si el
      // anterior quedó pendiente (tope, plantilla), se reintenta; si ya salió, no.
      await afterResponse(async () => {
        await sendWorkshopRegistrationWhatsApp({ editionId: edition.id, interestId, contactId, firstName, ip }).catch((e) =>
          console.error("[taller-registro] WhatsApp del registro", e)
        );
      });
      // Al equipo, solo la primera vez (un registro repetido no llena la campana).
      if (!alreadyRegistered) {
        fireNotification({
          eventType: "WEB_LEAD_SUBMITTED",
          title: `Interés en el taller: ${[input.firstName, input.lastName].filter(Boolean).join(" ")}`,
          body: [phoneE164, input.email, `«${edition.title}»`, "se registró en la página"].filter(Boolean).join(" · "),
          href: `/admin/workshops/${encodeURIComponent(edition.slug)}?tab=interesadas`,
          entityType: "Contact",
          entityId: contactId,
          metadata: { source: "taller_registro", workshopEditionId: edition.id, ref: input.ref },
          staff: "ALL",
        });
      }
    }
    return NextResponse.json(OK);
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_PHONE") {
      return NextResponse.json({ error: "invalid_phone", message: "Número de teléfono inválido" }, { status: 400 });
    }
    console.error("[taller-registro]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
