import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTestEmailStaff } from "@/lib/auth/api-staff";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/channels/email";
import { siteUrl } from "@/lib/notifications/config";
import {
  resolveDryRun,
  resolveNotificationsEnabled,
} from "@/lib/notifications/platform/resolve";
import { wrapEmailHtml } from "@/lib/notifications/templates/email-layout";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  to: z.email().max(200).optional(),
});

const TEMPLATE_KEY = "admin_test_email";

export const POST = async (req: Request) => {
  const staff = await requireTestEmailStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = bodySchema.safeParse(
    await req.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const to = parsed.data.to?.trim() || staff.email;
  const dryRun = await resolveDryRun();
  const sentAt = new Date();
  const subject = "Correo de prueba — CRM Dayana Beltrán PNL";

  const html = wrapEmailHtml({
    eyebrow: "Diagnóstico",
    title: "El correo funciona",
    preheader: "Prueba enviada desde Ajustes → Integraciones.",
    bodyHtml: `<p style="margin:0 0 14px;">Este es un correo de prueba enviado desde <strong>Ajustes → Integraciones</strong> del CRM.</p>
      <p style="margin:0;">Si lo estás leyendo, la configuración de envío del sitio está operativa.</p>`,
    summaryRows: [
      { label: "Solicitado por", value: staff.displayName },
      { label: "Destinatario", value: to },
      { label: "Fecha", value: sentAt.toLocaleString("es-CO") },
    ],
    footnote:
      "Correo automático de diagnóstico. No requiere respuesta.",
    ctaPrimary: { label: "Abrir el CRM", href: `${siteUrl()}/admin` },
  });

  const text = [
    "Correo de prueba del CRM Dayana Beltrán PNL.",
    "",
    `Solicitado por: ${staff.displayName}`,
    `Destinatario: ${to}`,
    `Fecha: ${sentAt.toLocaleString("es-CO")}`,
    "",
    "Si lo estás leyendo, la configuración de envío del sitio está operativa.",
  ].join("\n");

  let providerId = "dry-run";
  let errorMessage: string | null = null;

  try {
    // `sendEmail` ya corta en seco cuando NOTIFICATIONS_DRY_RUN está activo y
    // devuelve providerId "dry-run"; no hace falta duplicar la comprobación.
    const result = await sendEmail({ to, subject, html, text });
    providerId = result.providerId;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : "error desconocido";
  }

  // Se registra siempre, haya salido o no: el registro de envíos es la
  // auditoría, y un intento fallido es justo lo que hay que poder ver.
  await prisma.notificationDelivery.create({
    data: {
      contactId: null,
      staffUserId: staff.id,
      channel: "EMAIL",
      status: errorMessage ? "FAILED" : dryRun ? "SKIPPED" : "SENT",
      templateKey: TEMPLATE_KEY,
      subject,
      bodySnapshot: text,
      recipient: to,
      providerId,
      errorMessage,
      sentAt: errorMessage || dryRun ? null : sentAt,
    },
  });

  if (errorMessage) {
    return NextResponse.json(
      { error: "send_failed", detail: errorMessage, providerId, dryRun },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    to,
    providerId,
    dryRun,
    notificationsEnabled: await resolveNotificationsEnabled(),
  });
};
