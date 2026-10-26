/**
 * Desde qué página del sitio empezó un pago, para poder volver ahí si se
 * cancela o falla.
 *
 * `/pago/cancelado` y `/pago/fallido` no saben qué compraba la persona: llegan
 * de PayPal o de Mercado Pago y las dos URL de retorno son fijas. Mandaban a
 * quien ya había decidido pagar al cuestionario de terapias o a `/#servicios`,
 * que no es lo que estaba comprando (un curso, un taller, un enlace que le
 * mandó Dayana).
 *
 * El navegador lo anota al salir (`sessionStorage`) y esas páginas lo leen al
 * volver. Lo que se lee es una ruta de NUESTRO sitio y se valida aquí antes de
 * convertirse en un enlace: nada de URL completas, `//host` ni `..`.
 */

export const CHECKOUT_ORIGIN_KEY = "dayana:checkout-origin";

/**
 * Las páginas desde las que se inicia un pago y a las que tiene sentido volver:
 * enlaces de pago (`/pagar`), catálogo y ficha de cursos (`/cursos`), talleres,
 * el resultado del cuestionario (`/terapias`) y renovar la mensualidad
 * (`/cuenta/facturacion`).
 *
 * Sin `%` en los segmentos: nuestras rutas son ASCII sin codificar, y permitirlo
 * dejaba pasar `/pagar/%2e%2e/admin`, que el navegador resuelve a `/admin`.
 */
const ORIGIN_PATH =
  /^\/(pagar|cursos|taller-virtual|terapias|cuenta)(\/[A-Za-z0-9._~-]+)*\/?$/;

const MAX_LENGTH = 200;

/** Devuelve la ruta si es una de las nuestras y segura; si no, `null`. */
export const safeCheckoutOrigin = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const path = raw.trim();
  if (path.length === 0 || path.length > MAX_LENGTH) return null;
  if (!ORIGIN_PATH.test(path)) return null;
  // `.` y `..` entran en la clase de caracteres: se descartan como segmento.
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return path;
};
