import { revalidatePath } from "next/cache";

/**
 * Invalida el catálogo público tras cambios de precio o de tasa en el CRM.
 *
 * Las dos últimas se habían quedado fuera, y son precisamente las que pintan
 * `PublicProductCard`: cambiar el precio de un paquete no refrescaba el enlace
 * de pago que ya se había mandado ni el resultado del diagnóstico. Se anuncia
 * un precio y se cobra otro — el fallo que el resto del sistema de precios se
 * dedica a evitar.
 *
 * Van con `type: "page"` porque son rutas dinámicas: sin eso `revalidatePath`
 * sólo alcanzaría a la ruta literal, que nadie visita.
 */
export const revalidatePublicCatalog = (): void => {
  revalidatePath("/");
  revalidatePath("/terapias");
  revalidatePath("/cursos");
  revalidatePath("/api/plans");
  revalidatePath("/pagar/[token]", "page");
  revalidatePath("/terapias/resultado/[token]", "page");
};
