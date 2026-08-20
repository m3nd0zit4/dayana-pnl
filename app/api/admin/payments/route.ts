import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus } from "@prisma/client";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  isPlaceholderContactPhone,
  PLACEHOLDER_PHONE_PREFIX,
} from "@/lib/crm/checkout-placeholder";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const status = req.nextUrl.searchParams.get("status");
  // `?unidentified=1` es a donde apunta el aviso del panel: sirve la misma
  // lista ya filtrada en vez de obligar a buscarlos a ojo entre 50 filas.
  const onlyUnidentified =
    req.nextUrl.searchParams.get("unidentified") === "1";
  const limit = Math.min(
    100,
    Number(req.nextUrl.searchParams.get("limit") ?? 50)
  );

  const payments = await prisma.payment.findMany({
    where: {
      ...(status && status !== "all"
        ? { status: status as PaymentStatus }
        : {}),
      ...(onlyUnidentified
        ? {
            enrollment: {
              contact: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } },
            },
          }
        : {}),
    },
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

  return NextResponse.json({
    payments: payments.map((p) => ({
      ...p,
      /**
       * El teléfono `+pending:` es el único rastro de que la conciliación no
       * encontró a nadie. Se traduce a una bandera aquí para no filtrar el
       * placeholder al cliente ni obligarle a conocer el prefijo.
       */
      unidentified: isPlaceholderContactPhone(p.enrollment.contact.phoneE164),
    })),
  });
}
