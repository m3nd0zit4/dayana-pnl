import { NextRequest, NextResponse } from "next/server";
import { requireTestEmailStaff } from "@/lib/auth/api-staff";
import { wrapEmailHtml, varsToPlainParagraphs } from "@/lib/notifications/templates/email-layout";
import { sendEmail } from "@/lib/notifications/channels/email";
import {
  emailFrom,
  emailProviderId,
  isDryRun,
  isNotificationsEnabled,
} from "@/lib/notifications/config";
import { testEmailSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

const allowedTestDomains = (): string[] => {
  const from = process.env.NOTIFICATIONS_EMAIL_FROM?.trim().toLowerCase();
  if (!from) return [];
  const domain = from.split("@")[1];
  return domain ? [domain] : [];
};

export async function POST(req: NextRequest) {
  const staff = await requireTestEmailStaff();
  if (staff instanceof NextResponse) return staff;

  const raw = await req.json().catch(() => null);
  const parsed = testEmailSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const to = parsed.data.to ?? staff.email;
  const allowed = allowedTestDomains();
  const toDomain = to.split("@")[1]?.toLowerCase();
  if (allowed.length > 0 && toDomain && !allowed.includes(toDomain)) {
    return NextResponse.json(
      {
        error: "invalid_recipient_domain",
        hint: `Solo se permite enviar pruebas a @${allowed.join(", @")}`,
      },
      { status: 400 }
    );
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

  const paragraphs = parsed.data.message
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => p.trim());

  const html = wrapEmailHtml({
    title: parsed.data.subject,
    bodyHtml: varsToPlainParagraphs(paragraphs),
  });

  const text = [parsed.data.subject, "", parsed.data.message, "", "— Dayana Beltrán PNL"].join(
    "\n"
  );

  try {
    const result = await sendEmail({
      to,
      subject: `[CRM] ${parsed.data.subject}`,
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
