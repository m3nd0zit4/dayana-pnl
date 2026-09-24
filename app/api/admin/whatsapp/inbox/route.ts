import { after, NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { getInboxHealth } from "@/lib/meta/inbox-health";
import { drainInbox, kickSweep, requeueFailed } from "@/lib/meta/inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Salud de la cola de entrada. Mirarla también la barre (como mucho cada 30 s). */
export const GET = withStaff("read", async () => {
  after(() => kickSweep().catch(() => undefined));
  return NextResponse.json(await getInboxHealth());
});

/** «Reprocesar»: vuelve a poner en cola lo que falló y la vacía ya. */
export const POST = withStaff("write", async () => {
  const requeued = await requeueFailed();
  const stats = await drainInbox({ budgetMs: 90_000 });
  return NextResponse.json({ requeued, ...stats, health: await getInboxHealth() });
});
