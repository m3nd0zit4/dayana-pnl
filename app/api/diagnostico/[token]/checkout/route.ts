import { NextResponse } from "next/server";

import { markDiagnosticCheckoutStarted } from "@/lib/crm/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sella `checkoutStartedAt`. Sin límite de peticiones a propósito: la escritura
 * es un `updateMany` con guarda de `null`, así que la segunda llamada y la
 * milésima cuestan lo mismo y no cambian nada.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  try {
    await markDiagnosticCheckoutStarted(token);
  } catch (e) {
    console.error("[diagnostico] checkout mark failed", e);
  }
  // Siempre 200: es telemetría. Un error aquí no debe teñir de rojo la consola
  // del navegador de alguien que está a punto de pagar.
  return NextResponse.json({ ok: true });
}
