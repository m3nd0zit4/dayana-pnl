import { test, expect, gotoCrm } from "./fixtures/crm";
import { previewRoutes } from "./routes";

/**
 * Smoke: la ruta carga y no explota. Nada de esto depende del contrato de UX,
 * así que corre desde el primer día sobre las 16 rutas de preview.
 */
test.describe("CRM · smoke", () => {
  for (const route of previewRoutes) {
    test(`${route.name} (${route.path}) carga`, async ({
      page,
      consoleWatcher,
    }) => {
      const response = await gotoCrm(page, route.path);

      // 1. Respondió y no es un 4xx/5xx.
      expect(response, `sin respuesta para ${route.path}`).not.toBeNull();
      expect(response!.status(), `status de ${route.path}`).toBeLessThan(400);

      // 2. No rebotó al login: si esto falla, `CRM_UI_PREVIEW` no llegó al
      //    servidor o el `.env` metió un `DATABASE_URL` que gana.
      expect(page.url(), `${route.path} redirigió`).not.toContain("/acceso");

      // 3. El shell del panel está montado (sidebar del CRM).
      await expect(page.locator("[data-slot='sidebar-wrapper']")).toBeAttached();

      // 4. Hay título de documento.
      await expect(page).toHaveTitle(/.+/);

      // 5. Ni un error de consola ni una excepción sin capturar.
      expect(
        consoleWatcher.errors,
        `errores en ${route.path}:\n${consoleWatcher.errors.join("\n")}`,
      ).toEqual([]);
    });
  }
});
