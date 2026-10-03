import { withStaff } from "@/lib/api/handler";
import { endWorkshopResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** «Terminar»: realizada. Corta ventas y recordatorios. */
export const POST = withStaff<{ slug: string }>("write", async ({ staff, params }) =>
  endWorkshopResponse(params.slug, staff)
);
