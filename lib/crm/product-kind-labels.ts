import { ProductKind } from "@prisma/client";

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  THERAPY: "Terapia",
  COURSE: "Curso",
  WORKSHOP: "Taller",
};

export type ProductOption = {
  id: string;
  title: string;
  kind: ProductKind;
  isActive?: boolean;
};

export const groupProductsByKind = (products: ProductOption[]) => {
  const active = products.filter((p) => p.isActive !== false);
  const groups: { kind: ProductKind; label: string; items: ProductOption[] }[] = [];
  for (const kind of [ProductKind.THERAPY, ProductKind.COURSE, ProductKind.WORKSHOP] as const) {
    const items = active.filter((p) => p.kind === kind);
    if (items.length > 0) {
      groups.push({ kind, label: PRODUCT_KIND_LABEL[kind], items });
    }
  }
  return groups;
};
