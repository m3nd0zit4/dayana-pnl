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
import { isPlaceholderContactPhone } from "@/lib/crm/checkout-placeholder";
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
};

const sourceMap: Record<string, ContactSource> = {
  tiktok: ContactSource.TIKTOK,
  instagram: ContactSource.INSTAGRAM,
  youtube: ContactSource.YOUTUBE,
  web: ContactSource.WEB,
  whatsapp: ContactSource.WHATSAPP_DIRECT,
  referral: ContactSource.REFERRAL,
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
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const emailOnly =
    !phone &&
    typeof body.email === "string" &&
    body.email.trim() &&
    typeof body.enrollmentId === "string" &&
    body.enrollmentId.trim();

  if (emailOnly) {
    if (!body.consentData) {
      return NextResponse.json(
        { error: "consent_required", message: "Debes aceptar el tratamiento de datos" },
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
      { error: "missing_fields", message: "Teléfono y nombre son obligatorios" },
      { status: 400 }
    );
  }

  if (!body.consentData) {
    return NextResponse.json(
      { error: "consent_required", message: "Debes aceptar el tratamiento de datos" },
      { status: 400 }
    );
  }

  try {
    const sourceKey = (body.source ?? "web").toLowerCase();
    const { contact } = await upsertContactByPhone({
      phone,
      phoneCountry: body.phoneCountry,
      firstName,
      lastName: body.lastName,
      email: body.email,
      countryIso: body.countryIso,
      timezone: body.timezone,
      source: sourceMap[sourceKey] ?? ContactSource.WEB,
      sourceDetail: body.sourceDetail,
      consentData: true,
    });

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

    return NextResponse.json({
      ok: true,
      contactId: contact.id,
      enrollmentId: enrollmentId ?? null,
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
