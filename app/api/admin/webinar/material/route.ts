import { withStaff } from "@/lib/api/handler";
import { deleteMaterial, postMaterial } from "@/app/api/admin/eventos/_lib/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ruta de antes: el material del evento actual. Ver `/api/admin/eventos/[id]/material`. */
export const POST = withStaff("write", async (ctx) => postMaterial(ctx));

export const DELETE = withStaff("write", async (ctx) => deleteMaterial(ctx));
