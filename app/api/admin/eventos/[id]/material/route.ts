import { withStaff } from "@/lib/api/handler";
import { deleteMaterial, postMaterial } from "../../_lib/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** Material descargable del evento (un archivo; reemplaza al anterior). */
export const POST = withStaff<Params>("write", async (ctx) => postMaterial(ctx, ctx.params.id));

export const DELETE = withStaff<Params>("write", async (ctx) => deleteMaterial(ctx, ctx.params.id));
