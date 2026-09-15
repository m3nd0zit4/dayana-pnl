import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { canManageTeam } from "@/lib/crm/staff";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async ({ req, staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const limit = Math.min(100, Number(req.nextUrl.searchParams.get("limit") ?? 50));

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      staffUser: { select: { displayName: true, email: true } },
    },
  });

  return NextResponse.json({ logs });
});
