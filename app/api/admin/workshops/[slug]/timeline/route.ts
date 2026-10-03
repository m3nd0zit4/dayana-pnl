import { withStaff } from "@/lib/api/handler";
import { timelineWorkshopResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** La historia de la edición: actividad, envíos, pagos por día y recordatorios. */
export const GET = withStaff<{ slug: string }>("read", async ({ params }) => timelineWorkshopResponse(params.slug));
