import { NextResponse } from "next/server";
import { withStaff } from "@/lib/api/handler";
import { listWorkshopEditionsAdminWithPricing } from "@/lib/crm/workshop-editions";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { createWorkshopResponse } from "./_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Todas las ediciones con su precio vigente y sus pagadas. */
export const GET = withStaff("read", async () => {
  const editions = await listWorkshopEditionsAdminWithPricing();
  return NextResponse.json({
    editions,
    operationalTimezone: await getOperationalTimezone(),
  });
});

/**
 * «Nuevo taller», como «Nuevo evento»: un borrador con título, fecha y hora
 * (opcionales) y, si se pide, la página de otra edición. Lo demás —precio,
 * enlace, documentos— se pone en su detalle; publicar va con su botón.
 */
export const POST = withStaff("write", async (ctx) => createWorkshopResponse(ctx));
