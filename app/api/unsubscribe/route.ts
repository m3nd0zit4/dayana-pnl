import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/crm/audit";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

export const dynamic = "force-dynamic";

const page = (body: string, status = 200) =>
  new NextResponse(
    `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Dayana Beltrán PNL</title></head><body style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#0a0a0a;">${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

/** Confirmation page — does NOT unsubscribe on GET alone, so a link-prefetch bot can't opt someone out by just visiting the URL. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const contactId = verifyUnsubscribeToken(token);
  if (!contactId) {
    return page("<p>Este enlace no es válido o ya expiró.</p>", 400);
  }

  return page(`
    <h1 style="font-size:20px;">Dejar de recibir correos</h1>
    <p>¿Quieres dejar de recibir correos de Dayana Beltrán PNL?</p>
    <form method="POST" action="/api/unsubscribe?token=${encodeURIComponent(token as string)}">
      <button type="submit" style="background:#c0654a;color:#fff;border:none;padding:12px 24px;border-radius:999px;font-size:14px;cursor:pointer;">Sí, darme de baja</button>
    </form>
  `);
}

/** RFC 8058 one-click unsubscribe — Gmail/Yahoo POST this URL directly with `List-Unsubscribe=One-Click`, no page render, fast 200. */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const contactId = verifyUnsubscribeToken(token);
  if (!contactId) {
    return page("<p>Este enlace no es válido o ya expiró.</p>", 400);
  }

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) {
    return page("<p>Este enlace no es válido o ya expiró.</p>", 400);
  }

  if (contact.notifyEmail) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { notifyEmail: false },
    });
    await writeAuditLog({
      action: "UNSUBSCRIBE_EMAIL",
      entityType: "Contact",
      entityId: contactId,
    });
  }

  return page("<p>Listo — no recibirás más correos de Dayana Beltrán PNL.</p>");
}
