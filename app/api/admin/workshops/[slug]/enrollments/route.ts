import { withStaff } from "@/lib/api/handler";
import { getEnrollmentsResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Las inscritas pagadas de la edición, paginadas, con sus recordatorios. */
export const GET = withStaff<{ slug: string }>("read", async ({ req, params }) =>
  getEnrollmentsResponse(req, params.slug)
);
