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
 */
export const requirePortalContext = async (): Promise<PortalContext> => {
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
};
