import { withStaff } from "@/lib/api/handler";
import { publishWorkshopResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Publica la edición y cierra las inscripciones de la que estuviera publicada. */
export const POST = withStaff<{ slug: string }>("write", async ({ staff, params }) =>
  publishWorkshopResponse(params.slug, staff)
);
