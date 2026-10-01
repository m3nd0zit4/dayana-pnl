import type { NextRequest } from "next/server";
import { postResend } from "../../../_lib/handlers";

export const dynamic = "force-dynamic";

/** Reenvío manual de los correos de este evento. `all` es solo para OWNER. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return postResend(req, id);
}
