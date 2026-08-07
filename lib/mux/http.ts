import { NextResponse } from "next/server";

/**
 * Respuestas HTTP de Mux, separadas de `lib/mux/client.ts` a propósito.
 *
 * `client.ts` lo importan ahora cadenas que acaban en las herramientas del
 * agente (`agent/tools/*` → `lib/crm/free-webinar.ts` → `getMuxClient`). Eve
 * empaqueta esas herramientas fuera del runtime de Next, así que en cuanto el
 * módulo arrastraba `next/server` el servidor de eve moría al arrancar con
 * «Cannot find module .../next/server» y se llevaba por delante el dev server
 * entero.
 *
 * Regla práctica: nada que puedan alcanzar las herramientas del agente debe
 * importar `next/server`. Los helpers de respuesta viven aquí; solo los
 * consumen route handlers, que sí corren dentro de Next.
 */
export const muxNotConfiguredResponse = () =>
  NextResponse.json({ error: "mux_not_configured" }, { status: 503 });
