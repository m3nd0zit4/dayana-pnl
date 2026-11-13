import { prisma } from "@/lib/db";

import { REGISTRATION_TEMPLATE_KEY } from "./workshop-registration-rules";

/**
 * Lo que queda del registro en la página del taller (28-oct a 13-nov). La
 * dueña lo quitó el 13-nov («quita la lógica de registro… deja solo la página
 * de talleres y la página del taller»): no hay formulario, ruta ni botón en
 * `/enlaces`. Solo lo lee el CRM: las filas «Se registró en la página» que ya
 * existen siguen en «Interesadas», con el estado de su plantilla.
 */

/** La plantilla del registro tal como la dejó Meta (estado y categoría), o null si nunca se mandó. */
export const registrationTemplateState = async (): Promise<{ status: string | null; category: string | null } | null> => {
  const t = await prisma.messageTemplate.findFirst({
    where: { key: REGISTRATION_TEMPLATE_KEY, metaTemplateName: { not: null } },
    select: { metaApprovalStatus: true, metaCategory: true },
  });
  return t ? { status: t.metaApprovalStatus, category: t.metaCategory } : null;
};
