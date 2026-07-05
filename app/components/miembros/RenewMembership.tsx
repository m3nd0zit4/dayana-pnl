"use client";

import { useEffect } from "react";
import type { Plan } from "@/lib/plans";
import {
  readStoredCheckoutContact,
  writeStoredCheckoutContact,
} from "@/lib/checkout-contact-storage";
import PlanCheckoutButtons from "@/app/components/payments/PlanCheckoutButtons";

type RenewMembershipProps = {
  plan: Plan;
  userCountry: string | null;
  prefill: {
    email: string | null;
    phone: string | null;
    phoneCountry: string | null;
    firstName: string;
    lastName: string | null;
  };
};

/**
 * Reuses the public checkout for monthly renewals. Prefills the checkout
 * contact step with the member's registered data — the email is what anchors
 * the payment to their CRM contact (upsertContactByPhone matches email first).
 */
const RenewMembership = ({ plan, userCountry, prefill }: RenewMembershipProps) => {
  useEffect(() => {
    if (!prefill.email) return;
    const stored = readStoredCheckoutContact();
    writeStoredCheckoutContact({
      email: prefill.email,
      phone: prefill.phone ?? stored?.phone ?? "",
      phoneCountry: prefill.phoneCountry ?? stored?.phoneCountry ?? "",
      firstName: prefill.firstName,
      lastName: prefill.lastName ?? undefined,
    });
  }, [prefill]);

  return (
    <PlanCheckoutButtons plan={plan} isDark={false} userCountry={userCountry} />
  );
};

export default RenewMembership;
