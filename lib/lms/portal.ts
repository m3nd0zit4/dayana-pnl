import { cache } from "react";
import { redirect } from "next/navigation";
import type { Contact, MemberAccount, Product } from "@prisma/client";
import { getMemberSession } from "@/lib/auth/member-session";
import {
  getCourseProduct,
  getMembershipForContact,
  type MembershipInfo,
} from "./membership";

export type PortalContext = {
  contact: Contact;
  account: MemberAccount;
  membership: MembershipInfo;
  /** Course whose content the portal shows (enrollment's product, else the active course). */
  courseProduct: Product | null;
};

/**
 * Session + membership for portal pages. The proxy already redirects
 * unauthenticated visitors; this is the server-side backstop.
 *
 * ## Por qué va envuelto en `cache()`
 *
 * En `/cuenta` esto se llama DOS veces por navegación: una en el layout, que
 * hace de guardián, y otra en la página, que necesita los datos. Sin
 * memoizar son dos validaciones de sesión y dos consultas de membresía para
 * pintar una sola pantalla — y como no hay nada que enseñar hasta que las
 * cuatro terminan, cambiar de pestaña se quedaba congelado el tiempo
 * suficiente para parecer una recarga entera.
 *
 * `cache()` de React deduplica **por petición**: la segunda llamada dentro del
 * mismo render devuelve lo que ya calculó la primera. No cachea entre
 * peticiones, así que no cambia en nada la frescura del dato — cada visita
 * sigue leyendo la sesión y la membresía de verdad.
 */
export const requirePortalContext = cache(async (): Promise<PortalContext> => {
  const member = await getMemberSession();
  if (!member) {
    redirect("/acceso");
  }

  const membership = await getMembershipForContact(member.contact.id);
  const courseProduct =
    membership.enrollment?.product ?? (await getCourseProduct());

  return {
    contact: member.contact,
    account: member.account,
    membership,
    courseProduct,
  };
});
