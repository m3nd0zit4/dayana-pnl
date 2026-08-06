import { test, expect } from "@playwright/test";
import { authRoutes } from "../routes";

/**
 * Tier B: las 12 rutas que no tienen rama de preview y necesitan sesión + DB.
 *
 * Este proyecto no se registra siquiera sin `DATABASE_URL`, así que en CI hoy
 * no corre. Está aquí para poder ejecutarlo en local contra una rama Neon de
 * scratch, y para que activarlo en CI sea configurar un secret y nada más.
 *
 * Ojo con dos rutas de este grupo: `/admin/inbox` y `/admin/contenido` son
 * también las dos con layout más particular (dos paneles y editor inline de
 * fila). Son exactamente las que menos cubre la automatización y las que más
 * QA manual necesitan.
 */
test.describe("CRM · smoke autenticado (Tier B)", () => {
  for (const route of authRoutes) {
    test(`${route.name} (${route.path}) carga con sesión`, async ({ page }) => {
      const response = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
      });

      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(400);
      expect(page.url(), `${route.path} rebotó al login`).not.toContain(
        "/acceso",
      );
      await expect(page.locator("[data-slot='sidebar-wrapper']")).toBeAttached();
    });
  }
});
