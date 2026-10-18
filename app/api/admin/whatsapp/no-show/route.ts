import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { checkMeetPresence } from "@/lib/crm/whatsapp-agent/no-show";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * ¿Google deja leer quién entró a Meet con la cuenta de Dayana? `?meet=<enlace>`
 * o, sin nada, la sesión con Meet más reciente de las últimas 6 h. Solo lectura.
 */
export const GET = withStaff("owner", async ({ req }) => {
  const meet = new URL(req.url).searchParams.get("meet");
  return NextResponse.json(await checkMeetPresence({ meetUrl: meet }));
});
