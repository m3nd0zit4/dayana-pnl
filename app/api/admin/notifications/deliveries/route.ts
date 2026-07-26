import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const CHANNELS = [
  "EMAIL",
  "SMS",
  "WHATSAPP_API",
  "WHATSAPP_LINK",
  "INTERNAL",
] as const;
const STATUSES = ["PENDING", "SENT", "FAILED", "SKIPPED"] as const;

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const isOneOf = <T extends readonly string[]>(
  values: T,
  raw: string | null
): raw is T[number] => raw != null && (values as readonly string[]).includes(raw);

/** Fecha `YYYY-MM-DD` → Date, o null si no parsea. */
const parseDate = (raw: string | null): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function GET(req: NextRequest) {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const params = req.nextUrl.searchParams;

  const take = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(params.get("limit") ?? PAGE_SIZE) || PAGE_SIZE)
  );
  const skip = Math.max(0, Number(params.get("skip") ?? 0) || 0);

  const channel = params.get("channel");
  const status = params.get("status");
  const recipient = params.get("recipient")?.trim();
  const from = parseDate(params.get("from"));
  const to = parseDate(params.get("to"));

  const where: Prisma.NotificationDeliveryWhereInput = {};
  if (isOneOf(CHANNELS, channel)) where.channel = channel;
  if (isOneOf(STATUSES, status)) where.status = status;
  if (recipient) {
    where.recipient = { contains: recipient, mode: "insensitive" };
  }
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      // `to` llega como día calendario: se incluye el día completo.
      ...(to ? { lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) } : {}),
    };
  }

  const [deliveries, total] = await Promise.all([
    prisma.notificationDelivery.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        channel: true,
        status: true,
        subject: true,
        recipient: true,
        providerId: true,
        errorMessage: true,
        templateKey: true,
        sentAt: true,
        createdAt: true,
        // Un envío apunta a un contacto **o** a un staff — ahora ambos son
        // posibles, así que la fila necesita saber a dónde enlazar.
        contact: { select: { id: true, firstName: true, lastName: true } },
        staffUser: { select: { id: true, displayName: true } },
      },
    }),
    prisma.notificationDelivery.count({ where }),
  ]);

  return NextResponse.json({
    deliveries,
    total,
    skip,
    take,
    hasMore: skip + deliveries.length < total,
  });
}
