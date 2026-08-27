import { revalidatePath } from "next/cache";

/** Invalida catálogo público tras cambios de precio o tasa en CRM. */
export const revalidatePublicCatalog = (): void => {
  revalidatePath("/");
  revalidatePath("/terapias");
  revalidatePath("/cursos");
  revalidatePath("/api/plans");
};
