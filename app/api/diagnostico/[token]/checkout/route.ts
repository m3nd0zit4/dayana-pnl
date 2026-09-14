import { NextResponse } from "next/server";

import { markDiagnosticCheckoutStarted } from "@/lib/crm/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sella `checkoutStartedAt`, que desde que el resultado dejó de enseñar precio
 * significa «pulsó "Hablar con Dayana"» (el CTA principal del resultado). El
 * nombre de la columna se mantiene para no migrar. Sin límite de peticiones a propósito: la escritura
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
  // del navegador de alguien que está a punto de escribir a Dayana.
  return NextResponse.json({ ok: true });
}
