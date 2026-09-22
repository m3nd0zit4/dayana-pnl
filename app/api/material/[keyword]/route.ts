import { NextRequest, NextResponse, after } from "next/server";

import { claimMagnet, markClaimEmailSent } from "@/lib/crm/magnets";
import { sendEmail } from "@/lib/notifications/channels/email";
import { siteUrl } from "@/lib/notifications/config";
import {
  materialDeliveryHtml,
  materialDeliverySubject,
  materialDeliveryText,
} from "@/lib/notifications/templates/material-delivery";
import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Entrega del material de una palabra clave.
 *
 * El material viaja en la respuesta, no solo en el correo: quien llega de un
 * video quiere abrirlo YA, y un correo que tarda —o que cae en spam— es una
 * promesa incumplida delante de toda su sección de comentarios. El correo sale
 * después, con `after()`, y si falla no se lleva por delante la entrega.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`material:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { keyword } = await params;
  const body = (await req.json().catch(() => null)) as {
    firstName?: string;
    email?: string;
    source?: string;
  } | null;

  const firstName = body?.firstName?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";

  if (firstName.length < 2) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const claim = await claimMagnet({
    keyword,
    email,
    firstName,
    source: body?.source?.trim() || null,
  });
  if (!claim) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { magnet } = claim;
  // Un material subido al sitio se guarda como ruta; en el correo no hay
  // origen desde el que resolverla.
  const absoluteUrl = magnet.deliveryUrl.startsWith("http")
    ? magnet.deliveryUrl
    : `${siteUrl()}${magnet.deliveryUrl}`;

  if (claim.isNew) {
    after(async () => {
      try {
        const input = {
          firstName,
          title: magnet.title,
          description: magnet.description,
          deliveryUrl: absoluteUrl,
          keywordLabel: magnet.label,
        };
        await sendEmail({
          to: email,
          subject: materialDeliverySubject(input),
          html: materialDeliveryHtml(input),
          text: materialDeliveryText(input),
        });
        await markClaimEmailSent(claim.claimId);
      } catch (e) {
        // Ya lo tiene en pantalla: esto es la copia, no la entrega.
        console.error("[material] no se pudo enviar el correo", e);
      }
    });
  }

  return NextResponse.json({
    title: magnet.title,
    description: magnet.description,
    deliveryUrl: absoluteUrl,
    alreadyClaimed: !claim.isNew,
  });
}
