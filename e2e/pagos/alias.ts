/**
 * Resuelve el alias `@/` dentro del worker de Playwright.
 *
 * `recordPayment` carga la membresía y los eventos de Inngest con `import()`
 * diferido, y a esos Playwright no le aplica el mapeo de `paths`: el módulo
 * revienta con "Cannot find module '@/lib/db'" en mitad de un pago aprobado.
 * Engancharse a `_resolveFilename` lo arregla para toda la cadena sin tener
 * que reescribir imports de producción.
 *
 * Debe importarse ANTES que cualquier `lib/*` en la prueba.
 */
import path from "path";
import Module from "module";

type Resolver = (request: string, ...rest: unknown[]) => string;
const mod = Module as unknown as { _resolveFilename: Resolver };
const original = mod._resolveFilename;

mod._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  const mapped = request.startsWith("@/")
    ? path.join(process.cwd(), request.slice(2))
    : request;
  return original.call(this, mapped, ...rest) as string;
} as Resolver;
