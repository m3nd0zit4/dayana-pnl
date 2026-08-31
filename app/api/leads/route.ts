import { NextRequest, NextResponse } from "next/server";
import { ContactSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPlanId } from "@/lib/plans";
import {
  attachContactToEnrollment,
  createEnrollment,
  getEnrollmentById,
} from "@/lib/crm/enrollments";
import { upsertContactByPhone } from "@/lib/crm/contacts";
import { inviteContactToPortal } from "@/lib/crm/member-accounts";
import { isPlaceholderContactPhone } from "@/lib/crm/checkout-placeholder";
import {
  contactHasTag,
  ensureWebinarGratuitoTag,
  isWebinarInterest,
  WEBINAR_GRATUITO_TAG_SLUG,
  WEBINAR_INTEREST_LABEL,
} from "@/lib/crm/tags";
import {
  ensureFreeWebinar,
  formatWebinarScheduleLabel,
} from "@/lib/crm/free-webinar";
import { recordWebinarRegistration } from "@/lib/crm/webinar-registrations";
import { completeDiagnostic } from "@/lib/crm/diagnostics";
import {
  notifyNewLead,
  notifyWebinarRegistration,
} from "@/lib/notifications/lead-notify";
import { fireNotification } from "@/lib/notifications/platform/emit";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  phone?: string;
  phoneCountry?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  countryIso?: string;
  timezone?: string;
  planId?: string;
  enrollmentId?: string;
  consentData?: boolean;
  source?: string;
  sourceDetail?: string;
  /** Web contact form extras — used only for the notification email. */
  interest?: string;
  message?: string;
  notify?: boolean;
  /** Optional CRM tag slug (e.g. webinar-gratuito). */
  tag?: string;
  /**
   * Consentimiento de medición publicitaria. Separado de `consentData` a
   * propósito: aceptar que te contacten no es aceptar que tus datos se envíen
   * a Meta. Sin esta bandera, CAPI no manda nada de este contacto.
   */
  consentAdTracking?: boolean;
  /**
   * Cierra el cuestionario de `/terapias/empezar` con este contacto. Se hace aquí y
   * no en una ruta propia para no duplicar el alta de contacto, la inscripción
   * LEAD, la invitación al portal y la notificación al panel — todo eso ya
   * está probado en este camino.
   */
  diagnosticToken?: string;
  /**
   * Las respuestas tal y como las tiene el cliente. Viajan **siempre**, no sólo
   * cuando falta el token: el token puede existir y la fila haber quedado vacía
   * porque el autoguardado no pudo escribir. Con esto no hay ningún camino en
   * el que alguien conteste el cuestionario entero y se quede sin resultado.
   */
  diagnosticAnswers?: unknown;
};

const sourceMap: Record<string, ContactSource> = {
  tiktok: ContactSource.TIKTOK,
  instagram: ContactSource.INSTAGRAM,
  youtube: ContactSource.YOUTUBE,
  web: ContactSource.WEB,
  web_lead_form: ContactSource.WEB_LEAD_FORM,
  whatsapp: ContactSource.WHATSAPP_DIRECT,
  referral: ContactSource.REFERRAL,
};

const appendWebinarNote = async (
  contactId: string,
  alreadyRegistered: boolean
): Promise<void> => {
  const stamp = new Date().toLocaleDateString("es-CO", { dateStyle: "medium" });
  const line = alreadyRegistered
    ? `[${stamp}] Re-registro webinar gratuito (ya tenía la etiqueta).`
    : `[${stamp}] Registro webinar gratuito.`;
  const current = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { notes: true },
  });
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      notes: current?.notes ? `${current.notes}\n${line}` : line,
    },
  });
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`leads:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const phone = typeof body.phone === "string" ? body.phone : "";
  const firstName =
    typeof body.firstName === "string" ? body.firstName.trim() : "";
  const emailOnly =
    !phone &&
    typeof body.email === "string" &&
    body.email.trim() &&
    typeof body.enrollmentId === "string" &&
    body.enrollmentId.trim();

  if (emailOnly) {
    if (!body.consentData) {
      return NextResponse.json(
        {
          error: "consent_required",
          message: "Debes aceptar el tratamiento de datos",
        },
        { status: 400 }
      );
    }
    try {
      const enrollment = await getEnrollmentById(body.enrollmentId!.trim());
      if (!enrollment) {
        return NextResponse.json(
          { error: "not_found", message: "Servicio no encontrado" },
          { status: 404 }
        );
      }
      if (isPlaceholderContactPhone(enrollment.contact.phoneE164)) {
        return NextResponse.json(
          { error: "legacy_contact", message: "Completa teléfono y nombre" },
          { status: 400 }
        );
      }
      await prisma.contact.update({
        where: { id: enrollment.contactId },
        data: { email: body.email!.trim().toLowerCase() },
      });
      return NextResponse.json({ ok: true, contactId: enrollment.contactId });
    } catch (e) {
      console.error("[leads] email-only", e);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
  }

  if (!phone || !firstName) {
    return NextResponse.json(
      {
        error: "missing_fields",
        message: "Teléfono y nombre son obligatorios",
      },
      { status: 400 }
    );
  }

  if (!body.consentData) {
    return NextResponse.json(
      {
        error: "consent_required",
        message: "Debes aceptar el tratamiento de datos",
      },
      { status: 400 }
    );
  }

  try {
    const sourceKey = (body.source ?? "web").toLowerCase();
    const interestValue =
      typeof body.interest === "string" ? body.interest.trim() : "";
    const sourceDetailValue =
      (typeof body.sourceDetail === "string" && body.sourceDetail.trim()) ||
      interestValue ||
      undefined;

    const wantsWebinarTag =
      body.tag === WEBINAR_GRATUITO_TAG_SLUG ||
      isWebinarInterest(sourceDetailValue) ||
      isWebinarInterest(interestValue);

    const { contact, created } = await upsertContactByPhone({
      phone,
      phoneCountry: body.phoneCountry,
      firstName,
      lastName: body.lastName,
      email: body.email,
      countryIso: body.countryIso,
      timezone: body.timezone,
      source: sourceMap[sourceKey] ?? ContactSource.WEB,
      // Always refresh detalle origen so CRM shows the current interest
      // (e.g. Webinar gratuito) even when the contact already existed.
      sourceDetail: wantsWebinarTag
        ? WEBINAR_INTEREST_LABEL
        : sourceDetailValue,
      consentData: true,
      consentAdTracking: body.consentAdTracking === true,
    });

    // El diagnóstico se cierra antes que nada más: es lo que decide el perfil
    // y la etiqueta con la que el resto del embudo va a tratar a esta persona.
    let diagnosticProfile: string | null = null;
    let diagnosticToken: string | null = null;
    const hasDiagnostic =
      (typeof body.diagnosticToken === "string" && body.diagnosticToken) ||
      body.diagnosticAnswers != null;
    if (hasDiagnostic) {
      try {
        const diagnostic = await completeDiagnostic(
          typeof body.diagnosticToken === "string" ? body.diagnosticToken : null,
          contact.id,
          body.diagnosticAnswers
        );
        diagnosticProfile = diagnostic?.profile ?? null;
        // Se devuelve el token —el que vino o el que se acaba de crear— porque
        // es la URL del resultado. Sin esto el cliente no sabría a dónde ir
        // cuando la fila la creó el servidor.
        diagnosticToken = diagnostic?.token ?? null;
      } catch (e) {
        console.error("[leads] diagnostic completion failed", e);
      }
    }

    let alreadyRegistered = false;
    let webinarMeetUrl: string | null = null;
    let webinarScheduleLabel: string | null = null;
    // Un formulario cacheado puede llegar después del webinar. Sin esta guarda
    // se crea una inscripción contra una edición terminada y se manda un
    // enlace de Meet muerto. El contacto se guarda igual — sigue siendo un
    // lead válido — pero no entra en la lista de esta edición.
    let webinarOpen = false;
    if (wantsWebinarTag) {
      try {
        // `alreadyRegistered` sigue derivándose de la etiqueta, no de la tabla
        // de registros: los contactos anteriores a esa tabla tienen etiqueta y
        // el mensaje "ya estabas registrada" debe seguir siendo correcto.
        alreadyRegistered = await contactHasTag(
          contact.id,
          WEBINAR_GRATUITO_TAG_SLUG
        );
        await ensureWebinarGratuitoTag(contact.id);
        await appendWebinarNote(contact.id, alreadyRegistered);

        const webinar = await ensureFreeWebinar();
        webinarOpen = webinar.isActive && !webinar.endedAt;

        if (webinarOpen) {
          webinarMeetUrl = webinar.meetUrl;
          webinarScheduleLabel = formatWebinarScheduleLabel(webinar);
          // Si la confirmación ya lleva el enlace dentro, se sella el envío
          // aquí mismo: si no, el fan-out mandaría un segundo correo con
          // exactamente lo mismo unos minutos después.
          await recordWebinarRegistration(webinar.id, contact.id, {
            linkAlreadySent: Boolean(
              webinarMeetUrl && body.email && body.email.includes("@")
            ),
          });
        }
      } catch (e) {
        console.error("[leads] webinar registration failed", e);
      }
    }

    let enrollmentId = body.enrollmentId;

    if (enrollmentId) {
      const existing = await getEnrollmentById(enrollmentId);
      if (existing) {
        await attachContactToEnrollment(enrollmentId, contact.id);
      } else {
        enrollmentId = undefined;
      }
    }

    if (!enrollmentId && body.planId && isPlanId(body.planId)) {
      const enrollment = await createEnrollment({
        contactId: contact.id,
        productId: body.planId,
        status: "LEAD",
      });
      enrollmentId = enrollment.id;
    }

    // Transactional emails (best-effort; never blocks the lead).
    if (body.notify) {
      try {
        if (wantsWebinarTag && webinarOpen) {
          await notifyWebinarRegistration({
            firstName,
            lastName: body.lastName,
            phoneE164: contact.phoneE164 ?? phone,
            phoneCountry: body.phoneCountry,
            email: body.email,
            interest: WEBINAR_INTEREST_LABEL,
            message: body.message,
            source: sourceKey,
            alreadyRegistered,
            scheduleLabel: webinarScheduleLabel,
            meetUrl: webinarMeetUrl,
          });
        } else {
          await notifyNewLead({
            firstName,
            lastName: body.lastName,
            phoneE164: contact.phoneE164 ?? phone,
            phoneCountry: body.phoneCountry,
            email: body.email,
            interest: body.interest,
            message: body.message,
            source: sourceKey,
          });
        }
      } catch {
        /* notification is non-critical */
      }
    }

    // Portal invite for general leads only. Webinar registrants get the
    // webinar confirmation email instead — a set-password invite confuses
    // the "ya estás registrada / enlace del webinar" flow.
    if (!wantsWebinarTag) {
      try {
        await inviteContactToPortal(contact.id);
      } catch (e) {
        console.error("[leads] portal invite failed", e);
      }
    }

    fireNotification({
      eventType: "WEB_LEAD_SUBMITTED",
      title: wantsWebinarTag
        ? `${alreadyRegistered ? "Re-registro" : "Registro"} webinar: ${[firstName, body.lastName].filter(Boolean).join(" ")}`
        : `Formulario web: ${[firstName, body.lastName].filter(Boolean).join(" ")}`,
      body: [
        contact.phoneE164 ?? phone,
        body.email?.trim() || null,
        wantsWebinarTag
          ? `Interés: ${WEBINAR_INTEREST_LABEL}`
          : body.interest
            ? `Interés: ${body.interest}`
            : null,
        body.message?.trim() || null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/contacts/${contact.id}`,
      entityType: "Contact",
      entityId: contact.id,
      metadata: {
        source: sourceKey,
        enrollmentId: enrollmentId ?? null,
        webinar: wantsWebinarTag,
        alreadyRegistered,
        diagnosticProfile,
      },
      staff: "ALL",
    });

    return NextResponse.json({
      ok: true,
      contactId: contact.id,
      enrollmentId: enrollmentId ?? null,
      created,
      alreadyRegistered,
      webinar: wantsWebinarTag,
      diagnosticProfile,
      diagnosticToken,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    if (message === "INVALID_PHONE") {
      return NextResponse.json(
        { error: "invalid_phone", message: "Número de teléfono inválido" },
        { status: 400 }
      );
    }
    console.error("[leads]", message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
