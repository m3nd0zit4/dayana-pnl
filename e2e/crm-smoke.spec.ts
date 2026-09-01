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

  /**
   * La página hidrata de verdad.
   *
   * No es una comprobación teórica: durante un tiempo NO hidrataba y toda la
   * suite pasaba igual. `baseURL` es `127.0.0.1` y el dev server de Next sólo
   * sirve `/_next/*` a los orígenes que reconoce, así que el HTML y el CSS
   * llegaban y el JavaScript de cliente no. Sin un solo error de consola: el
   * panel se veía perfecto y ningún `onClick` respondía. Lo tapa
   * `DEV_ALLOWED_ORIGIN` en `playwright.config.ts`, y esto es lo que avisa si
   * alguien lo quita.
   *
   * Se mira la fibra de React en el DOM en vez de pulsar algo, porque en modo
   * vista previa casi nada es interactivo —`canManageTeam` es false— y un test
   * de clic se saltaría solo, que es exactamente cómo pasó desapercibido.
   */
  test("el panel hidrata (React se engancha al DOM servido)", async ({
    page,
  }) => {
    await gotoCrm(page, "/admin/products");

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.querySelector("[data-crm-page]");
            return el
              ? Object.keys(el).some((k) => k.startsWith("__react"))
              : false;
          }),
        {
          message:
            "React nunca se enganchó: mira DEV_ALLOWED_ORIGIN en playwright.config.ts",
          timeout: 30_000,
        },
      )
      .toBe(true);
  });
});
