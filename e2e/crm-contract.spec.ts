import { test, expect, gotoCrm } from "./fixtures/crm";
import { previewRoutes, type CrmRoute } from "./routes";

/**
 * El contrato de patrones de UX del CRM, mecanizado.
 *
 * ── Cómo se usa ────────────────────────────────────────────────────────────
 * Toda ruta empieza en `PENDING_CONTRACT`. Cada PR de migración BORRA de esta
 * lista exactamente las rutas que migra. Es decir: este archivo es el tracker
 * de la reestructura, y CI impide que una ruta ya migrada retroceda.
 *
 * Cuando `PENDING_CONTRACT` quede vacío, la fase CRM está cerrada. No añadir
 * rutas a la lista para «arreglar» un fallo — el fallo significa que la
 * migración de esa ruta está incompleta.
 */
const PENDING_CONTRACT = new Set<string>([
  "/admin",
  "/admin/webinar",
  "/admin/notificaciones",
  "/admin/messages",
  "/admin/team",
  "/admin/audit",
]);

/** Etiquetas que delatan una acción primaria de creación. */
const CREATE_LABEL = /^\s*(Nuevo|Nueva|Crear|Añadir|Agregar)\b/i;

/** Ancho máximo permitido para el cuerpo de página (R1: `max-w-6xl` = 72rem). */
const MAX_CONTENT_WIDTH = 1200;

/**
 * `CRM_CONTRACT_BASELINE=1` ignora `PENDING_CONTRACT` y corre el contrato
 * contra todas las rutas. No es para CI: es para medir, antes de empezar a
 * migrar, cuánto incumple el panel hoy y no descubrirlo PR a PR.
 */
const baselineMode = process.env.CRM_CONTRACT_BASELINE === "1";

const contractRoutes = previewRoutes.filter(
  (r) => baselineMode || !PENDING_CONTRACT.has(r.path),
);

test.describe("CRM · contrato de patrones", () => {
  if (contractRoutes.length === 0) {
    test("ninguna ruta ha migrado todavía al contrato", () => {
      test.skip(
        true,
        `Las ${PENDING_CONTRACT.size} rutas siguen en PENDING_CONTRACT. ` +
          "Cada PR de migración debe quitar las suyas de la lista.",
      );
    });
  }

  for (const route of contractRoutes) {
    test.describe(`${route.name} (${route.path})`, () => {
      test.beforeEach(async ({ page }) => {
        await gotoCrm(page, route.path);
      });

      // R1 — un solo h1, renderizado por el page header.
      test("tiene exactamente un h1 con texto, dentro del page header", async ({
        page,
      }) => {
        const h1 = page.locator("h1");
        await expect(h1).toHaveCount(1);
        await expect(h1).not.toBeEmpty();
        await expect(
          page.locator("[data-crm-page-header] h1"),
          "el h1 debe venir de CrmPageHeader, no escrito a mano",
        ).toHaveCount(1);
      });

      // R1 — un solo contenedor de página.
      test("tiene exactamente un contenedor [data-crm-page]", async ({ page }) => {
        await expect(page.locator("[data-crm-page]")).toHaveCount(1);
      });

      // R1 — max-width y sin desbordamiento horizontal en móvil.
      test("respeta el ancho máximo y no desborda en móvil", async ({ page }) => {
        if (route.width === "full") {
          test.skip(true, "ruta declarada width=full: renuncia al max-width");
        }

        await page.setViewportSize({ width: 1440, height: 900 });
        const box = await page.locator("[data-crm-page]").boundingBox();
        expect(box, "sin bounding box").not.toBeNull();
        expect(box!.width).toBeLessThanOrEqual(MAX_CONTENT_WIDTH);

        await page.setViewportSize({ width: 390, height: 844 });
        const overflows = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(overflows, "hay scroll horizontal a 390px").toBe(false);
      });

      // R2 — la acción primaria vive en el header, y en ningún otro sitio.
      //
      // Se formula como invariante condicional, no como «tiene que existir»:
      // en modo vista previa el CRM es de solo lectura, así que las páginas no
      // pintan su botón de crear. Exigir su presencia haría fallar el contrato
      // por una diferencia de permisos, no por una desviación de patrón.
      if (route.hasPrimaryAction) {
        test("la acción primaria, si existe, está dentro del page header", async ({
          page,
        }) => {
          const primary = page.locator("[data-crm-primary-action]");
          const count = await primary.count();

          if (count > 0) {
            expect(count, "hay más de una acción primaria").toBe(1);
            await expect(
              page.locator("[data-crm-page-header] [data-crm-primary-action]"),
              "la acción primaria está fuera del page header",
            ).toHaveCount(1);
          }

          // Esta mitad se comprueba siempre, haya botón primario o no: es la
          // que impide la deriva. Sin ella basta con añadir un segundo «Nuevo»
          // en mitad de la lista para saltarse la regla.
          //
          // Se resuelve en el DOM y no encadenando locators porque lo que se
          // quiere expresar es contención («no está dentro de la cabecera»), y
          // los filtros de Playwright expresan relaciones entre coincidencias,
          // que no es lo mismo.
          const outside = await page.evaluate((pattern) => {
            const re = new RegExp(pattern, "i");
            const header = document.querySelector("[data-crm-page-header]");
            return Array.from(document.querySelectorAll("button"))
              .filter((b) => re.test((b.textContent ?? "").trim()))
              .filter((b) => !header?.contains(b))
              .map((b) => (b.textContent ?? "").trim());
          }, CREATE_LABEL.source);

          expect(
            outside,
            "botones de creación fuera del page header",
          ).toEqual([]);
        });
      }

      // R4 — el enlace a la página pública es uno, con target y rel correctos.
      if (route.hasPublicLink) {
        test("expone el enlace a la página pública con target y rel", async ({
          page,
        }) => {
          const link = page.locator("[data-crm-public-link]").first();
          await expect(link).toBeAttached();

          const anchor = link.locator("a").or(link).first();
          await expect(anchor).toHaveAttribute("target", "_blank");
          await expect(anchor).toHaveAttribute("rel", /noopener/);
        });
      }

      // R9 — el vacío es un empty state con encabezado, no un párrafo suelto.
      if (route.expectEmpty) {
        test("pinta un empty state con encabezado", async ({ page }) => {
          const empty = page.locator("[data-crm-empty]");
          await expect(empty).toHaveCount(1);
          await expect(empty.locator("h2, h3, p").first()).not.toBeEmpty();
        });
      }
    });
  }
});

/**
 * R5 — orden y alineación del footer de modal.
 *
 * Se prueba solo donde hay un modal de creación accesible desde la acción
 * primaria. Es el subconjunto de interacción: abre el modal de verdad y mira
 * el DOM resultante, en vez de confiar en que el componente se usó bien.
 */
const MODAL_FOOTER_ROUTES: CrmRoute[] = previewRoutes.filter(
  (r) =>
    r.hasPrimaryAction &&
    (baselineMode || !PENDING_CONTRACT.has(r.path)) &&
    ["/admin/products", "/admin/workshops", "/admin/promo-codes"].includes(
      r.path,
    ),
);

for (const route of MODAL_FOOTER_ROUTES) {
  test(`${route.name}: el footer del modal es Cancelar → Guardar, a la derecha`, async ({
    page,
  }) => {
    await gotoCrm(page, route.path);

    const primary = page.locator("[data-crm-page-header] [data-crm-primary-action]");
    if ((await primary.count()) === 0) {
      test.skip(
        true,
        "sin acción primaria en modo vista previa: no hay modal que abrir",
      );
    }
    await primary.click();

    const footer = page.locator("[data-crm-form-actions]").first();
    await expect(footer).toBeVisible();

    // El primario es el último botón del footer.
    const buttons = footer.locator("button");
    await expect(buttons).not.toHaveCount(0);
    const last = buttons.last();
    await expect(last).toHaveText(/Guardar|Crear|Añadir/i);

    // Y el contenedor alinea a la derecha en escritorio.
    const justify = await footer.evaluate(
      (el) => getComputedStyle(el).justifyContent,
    );
    expect(justify).toBe("flex-end");
  });
}

/**
 * Smoke de dark mode.
 *
 * Existe por un fallo concreto: `--crm-*` y `--portal-*` duplican los valores
 * de los tokens shadcn pero NO tienen bloque `.dark`, así que cualquier
 * componente atado a ellos ignora el toggle de tema. Webinar es el peor caso.
 *
 * Se excluye a propósito la barra superior (`.crm-topbar`), que es oscura en
 * ambos temas por decisión de diseño, no por deriva.
 */
test.describe("CRM · dark mode", () => {
  /**
   * Lista aparte de `PENDING_CONTRACT` a propósito.
   *
   * Que el tema funcione no depende de que una página haya migrado sus
   * patrones, sino de que `.crm-app` deje de colgar de `--crm-background` —
   * una variable que duplica el valor del token shadcn pero no tiene bloque
   * `.dark`, así que el panel entero ignora el interruptor de tema. Eso se
   * resuelve al colapsar los tokens, no al migrar una lista.
   *
   * Vaciar esta lista es lo último que hace ese trabajo.
   */
  const PENDING_DARK_MODE = new Set<string>(["/admin/webinar", "/admin/contacts"]);

  const DARK_ROUTES = ["/admin/webinar", "/admin/contacts"].filter(
    (path) => baselineMode || !PENDING_DARK_MODE.has(path),
  );

  for (const path of DARK_ROUTES) {
    test(`${path} responde al cambio de tema`, async ({ page }) => {
      await gotoCrm(page, path);

      // Se mide el `<body>`, no `[data-crm-page]`: ese contenedor es
      // transparente por diseño, así que su color calculado es el mismo en
      // ambos temas y la comprobación pasaría siempre.
      const readBg = () =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor);

      const light = await readBg();

      await page.evaluate(() => {
        document.documentElement.classList.add("dark");
      });
      // Un frame para que el navegador recalcule estilos.
      await page.waitForTimeout(100);

      const dark = await readBg();

      expect(
        dark,
        "el fondo no cambió con .dark — probablemente sigue atado a var(--crm-*)",
      ).not.toBe(light);
    });
  }
});
