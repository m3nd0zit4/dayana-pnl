import { NextResponse, type NextRequest } from "next/server";

/**
 * Piezas de las rutas de API sin dependencias de sesión ni base de datos, para
 * poder probarlas con `bun test`. `lib/api/handler.ts` las conecta con los
 * helpers de staff reales.
 *
 * Contrato que NO cambia al migrar una ruta: el cuerpo de error sigue siendo
 * `{ error, ...extra }` con el mismo código y el mismo status que antes; los
 * clientes comparan esos códigos literalmente.
 */

/** `{ error, ...extra }` con el status dado. */
export const apiError = (
  error: string,
  status: number,
  extra?: Record<string, unknown>
): NextResponse => NextResponse.json({ ...extra, error }, { status });

/**
 * Cuerpo JSON o `null` si no hay o no se puede leer. Mismo tipo que
 * `req.json().catch(() => null)` (`any`): las rutas que validan con zod no lo
 * notan y las que leen campos sueltos siguen compilando igual que antes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const readJson = async (req: Request): Promise<any> =>
  req.json().catch(() => null);

export type RouteContext<P> = { params: Promise<P> };

export type AuthedHandler<U, P> = (ctx: {
  req: NextRequest;
  staff: U;
  params: P;
}) => Response | Promise<Response>;

/**
 * Envuelve un handler con una comprobación de acceso. El resolver devuelve el
 * usuario o la respuesta de rechazo (401/403), que se devuelve tal cual, antes
 * de leer params o cuerpo — el mismo orden que tenían las rutas a mano.
 */
export function withResolver<U, P>(
  resolve: () => Promise<U | NextResponse>,
  handler: AuthedHandler<U, P>
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    const staff = await resolve();
    if (staff instanceof NextResponse) return staff;
    const params = ctx?.params ? await ctx.params : ({} as P);
    return handler({ req, staff, params });
  };
}
