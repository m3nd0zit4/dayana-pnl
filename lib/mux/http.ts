import { NextResponse } from "next/server";

/**
 * Respuestas HTTP de Mux, separadas de `lib/mux/client.ts` a propósito.
 *
 * `client.ts` lo importan cadenas que acaban en las herramientas del CRM
 * (`lib/crm-tools/tools/*` → `lib/crm/free-webinar.ts` → `getMuxClient`).
 * Esas herramientas también corren fuera de Next (el MCP por stdio, los
 * scripts e2e); el antiguo asistente del panel (eve, quitado en 2026-11) moría
 * al arrancar con «Cannot find module .../next/server» por esto.
 *
 * Regla práctica: nada que puedan alcanzar las herramientas del CRM debe
 * importar `next/server`. Los helpers de respuesta viven aquí; solo los
 * consumen route handlers, que sí corren dentro de Next.
 */
export const muxNotConfiguredResponse = () =>
  NextResponse.json({ error: "mux_not_configured" }, { status: 503 });
