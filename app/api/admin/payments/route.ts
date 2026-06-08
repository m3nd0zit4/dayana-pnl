import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus } from "@prisma/client";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const status = req.nextUrl.searchParams.get("status");
  const limit = Math.min(
    100,
    Number(req.nextUrl.searchParams.get("limit") ?? 50)
  );

  const payments = await prisma.payment.findMany({
    where:
      status && status !== "all"
        ? { status: status as PaymentStatus }
        : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      enrollment: {
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, phoneE164: true },
          },
          product: { select: { title: true } },
        },
      },
    },
  });

  return NextResponse.json({ payments });
}
