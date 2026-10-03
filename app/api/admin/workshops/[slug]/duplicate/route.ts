import { withStaff } from "@/lib/api/handler";
import { duplicateWorkshopResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** «Duplicar»: un borrador con la misma página, sin fecha, precio, inscritas ni enlace. */
export const POST = withStaff<{ slug: string }>("write", async ({ staff, params }) =>
  duplicateWorkshopResponse(params.slug, staff)
);
