import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { wrapEmailHtml, varsToPlainParagraphs } from "@/lib/notifications/templates/email-layout";
import { sendEmail } from "@/lib/notifications/channels/email";
import {
  emailFrom,
  emailProviderId,
  isDryRun,
  isNotificationsEnabled,
} from "@/lib/notifications/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  const subject = String(body?.subject ?? "").trim();
  const message = String(body?.message ?? "").trim();
  const toOverride = String(body?.to ?? "").trim();
  const to = toOverride || staff.email;

  if (!subject || !message) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  if (!isNotificationsEnabled()) {
    return NextResponse.json(
      { error: "notifications_disabled" },
      { status: 503 }
    );
  }

  if (!emailProviderId()) {
    return NextResponse.json(
      {
        error: "email_not_configured",
        hint: "Añade RESEND_API_KEY en .env (dominio dayanabeltran.com en Resend)",
      },
      { status: 422 }
    );
  }

  const paragraphs = message
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => p.trim());

  const html = wrapEmailHtml({
    title: subject,
    bodyHtml: varsToPlainParagraphs(paragraphs),
  });

  const text = [subject, "", message, "", "— Dayana Beltrán PNL"].join("\n");

  try {
    const result = await sendEmail({
      to,
      subject: `[CRM] ${subject}`,
      html,
      text,
    });

    return NextResponse.json({
      ok: true,
      to,
      from: emailFrom().email,
      dryRun: isDryRun(),
      providerId: result.providerId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
