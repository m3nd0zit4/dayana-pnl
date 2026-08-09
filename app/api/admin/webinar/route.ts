import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  ensureFreeWebinar,
  updateFreeWebinar,
  FreeWebinarMeetUrlError,
  setFreeWebinarEnded,
  FreeWebinarPublishError,
  PUBLISH_BLOCKER_LABELS,
  type FreeWebinarFaqItem,
} from "@/lib/crm/free-webinar";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { emitWebinarMeetLinkChanged } from "@/lib/inngest/events";

export const dynamic = "force-dynamic";

const faqItemSchema = z.object({
  q: z.string().min(1).max(300),
  a: z.string().min(1).max(2000),
});

const startsAtLocalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z
    .string()
    .regex(/^\d{1,2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
});

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  headline: z.string().min(1).max(300).optional(),
  subheadline: z.string().max(1000).nullable().optional(),
  body: z.string().max(2000).nullable().optional(),
  startsAtLocal: startsAtLocalSchema.nullable().optional(),
  startsAtIso: z.string().datetime().nullable().optional(),
  // Cadena vacía = "quitar el enlace"; el lib la normaliza a null.
  meetUrl: z.union([z.string().url(), z.literal("")]).nullable().optional(),
  /** Cerrar o reabrir a mano lo que el cron sella solo. */
  ended: z.boolean().optional(),
  learnSectionTitle: z.string().max(120).nullable().optional(),
  learnItems: z.array(z.string().min(1).max(400)).max(12).optional(),
  faq: z.array(faqItemSchema).max(12).optional(),
  ctaLabel: z.string().min(1).max(80).optional(),
  formTitle: z.string().min(1).max(120).optional(),
  metaTitle: z.string().max(120).nullable().optional(),
  metaDescription: z.string().max(320).nullable().optional(),
});

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const webinar = await ensureFreeWebinar();
  return NextResponse.json({
    webinar,
    operationalTimezone: await getOperationalTimezone(),
  });
}

export async function PATCH(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const faq = parsed.data.faq as FreeWebinarFaqItem[] | undefined;
  const { startsAtIso, startsAtLocal, ended, ...rest } = parsed.data;

  if (ended !== undefined) {
    const webinar = await setFreeWebinarEnded(ended);
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "FreeWebinar",
      entityId: webinar.id,
      changes: { ended },
    });
    return NextResponse.json({
      webinar,
      operationalTimezone: await getOperationalTimezone(),
    });
  }

  try {
    const { webinar, meetUrlChanged, startsAtChanged, linkEmailsReset } =
      await updateFreeWebinar({
        ...rest,
        faq,
        startsAt:
          startsAtIso === undefined
            ? undefined
            : startsAtIso === null
              ? null
              : new Date(startsAtIso),
        startsAtLocal:
          startsAtLocal === undefined ? undefined : startsAtLocal,
      });

    // Enlace nuevo o cambiado: se envía ya. Si Inngest no está configurado
    // (local, o la variable sin poner) se hace en línea con `after()` — un
    // enlace guardado no puede quedarse esperando a que alguien configure algo.
    if (meetUrlChanged && webinar.meetUrl) {
      const queued = await emitWebinarMeetLinkChanged(webinar.id);
      if (!queued) {
        after(async () => {
          const { sendPendingWebinarLinkEmails } = await import(
            "@/lib/crm/webinar-mailer"
          );
          await sendPendingWebinarLinkEmails();
        });
      }
    }

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "FreeWebinar",
      entityId: webinar.id,
      changes: {
        isActive: webinar.isActive,
        fields: Object.keys(parsed.data),
        startsAtIso: webinar.startsAtIso,
        meetUrlChanged,
        startsAtChanged,
      },
    });

    return NextResponse.json({
      webinar,
      meetUrlChanged,
      startsAtChanged,
      linkEmailsReset,
      operationalTimezone: await getOperationalTimezone(),
    });
  } catch (e) {
    if (e instanceof FreeWebinarMeetUrlError) {
      return NextResponse.json(
        {
          error: "invalid_meet_url",
          message: "El enlace de la reunión debe ser una URL https válida.",
        },
        { status: 400 }
      );
    }
    if (e instanceof FreeWebinarPublishError) {
      return NextResponse.json(
        {
          error: "not_publishable",
          blockers: e.blockers,
          message: `Falta: ${e.blockers
            .map((b) => PUBLISH_BLOCKER_LABELS[b])
            .join(", ")}`,
        },
        { status: 400 }
      );
    }
    if (e instanceof Error && e.message === "INVALID_ZONED_DATETIME") {
      return NextResponse.json(
        { error: "invalid_datetime", message: "Fecha u hora inválida." },
        { status: 400 }
      );
    }
    throw e;
  }
}
