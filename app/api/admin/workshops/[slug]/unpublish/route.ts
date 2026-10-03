import { withStaff } from "@/lib/api/handler";
import { unpublishWorkshopResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** «Cerrar inscripciones»: deja de venderse; quien pagó sigue recibiendo los recordatorios. */
export const POST = withStaff<{ slug: string }>("write", async ({ staff, params }) =>
  unpublishWorkshopResponse(params.slug, staff)
);
