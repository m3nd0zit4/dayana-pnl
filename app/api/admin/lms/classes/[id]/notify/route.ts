import { NextRequest, NextResponse } from "next/server";
import { EnrollmentStatus, ProductKind } from "@prisma/client";
import { requireBroadcastStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";
import { renderQuickMessage } from "@/lib/crm/render-message";
import { siteUrl } from "@/lib/notifications/config";
import { dispatchAndRecord } from "@/lib/notifications/dispatch";
import { broadcastPlatformNotification } from "@/lib/notifications/platform/emit";
import { isRecordingVisible } from "@/lib/lms/course-content";

export const dynamic = "force-dynamic";

const CHANNELS = ["EMAIL", "WHATSAPP_API"] as const;

/**
 * Mismo tope que `PLATFORM_BROADCAST_MAX`: pasado ese punto esto no es una
 * notificación de clase sino una campaña, y debe ir por Inngest, no por una
 * petición HTTP que envía en serie.
 */
const NOTIFY_MAX_TARGETS = 2000;

type RouteParams = { params: Promise<{ id: string }> };

/** Notifies members who are current on payments that a recording is up. */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireBroadcastStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const liveClass = await prisma.liveClassSession.findUnique({
    where: { id },
  });
  if (!liveClass) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!isRecordingVisible(liveClass)) {
    return NextResponse.json({ error: "no_visible_recording" }, { status: 400 });
  }

  const audienceWhere = {
    productId: liveClass.productId,
    status: EnrollmentStatus.ACTIVE,
    product: { kind: ProductKind.COURSE },
    paidUntil: { gt: new Date() },
  };

  // Contar antes de leer. broadcastPlatformNotification rechaza por encima de
  // su tope, pero lo hacía después de materializar la audiencia: se pagaba la
  // memoria y solo entonces se fallaba. Aquí se falla barato.
  const targetCount = await prisma.enrollment.count({ where: audienceWhere });
  if (targetCount > NOTIFY_MAX_TARGETS) {
    return NextResponse.json(
      { error: "audience_too_large", targets: targetCount },
      { status: 422 }
    );
  }

  const enrollments = await prisma.enrollment.findMany({
    where: audienceWhere,
    // `include: { contact: true }` traía cada contacto entero —incluida
    // `notes`, @db.Text— para usar solo el nombre.
    select: {
      contactId: true,
      contact: { select: { firstName: true } },
    },
  });

  const template = await prisma.messageTemplate.findUnique({
    where: { key_locale: { key: "new_recording_posted", locale: "es" } },
  });
  const body =
    template?.body ??
    "Hola {{first_name}}, ya está disponible la grabación de {{class_title}}. Estará un mes en el portal: {{portal_url}}";

  let sent = 0;
  for (const enrollment of enrollments) {
    const vars = {
      first_name: enrollment.contact.firstName,
      class_title: liveClass.title,
      portal_url: `${siteUrl()}/cursos`,
    };
    const rendered = renderQuickMessage(body, vars);
    for (const channel of CHANNELS) {
      const { result } = await dispatchAndRecord({
        contactId: enrollment.contactId,
        channel,
        templateKey: "new_recording_posted",
        body: rendered,
        vars,
      });
      if (result.status === "SENT") sent += 1;
    }
  }

  // Feed del portal para los mismos miembros que recibieron el mensaje.
  // Nunca puede tumbar la respuesta del envío que ya ocurrió.
  await broadcastPlatformNotification({
    eventType: "CLASS_RECORDING_PUBLISHED",
    title: `Ya está la grabación de ${liveClass.title}`,
    body: "Estará disponible un mes en el portal del curso.",
    href: "/cursos",
    entityType: "LiveClassSession",
    entityId: id,
    contactIds: enrollments.map((enrollment) => enrollment.contactId),
  }).catch(() => undefined);

  fireAuditLog({
    staffUserId: staff.id,
    action: "RECORDING_NOTIFIED",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { targets: enrollments.length, sent },
  });

  return NextResponse.json({ targets: enrollments.length, sent });
}
