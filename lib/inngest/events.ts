const shouldEmitInngest = (): boolean => {
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(process.env.INNGEST_EVENT_KEY?.trim());
};

export const emitPaymentApproved = async (enrollmentId: string) => {
  if (!shouldEmitInngest() && process.env.NODE_ENV === "production") {
    return;
  }
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "payment/approved",
      data: { enrollmentId },
    });
  } catch (e) {
    console.warn("[inngest] payment/approved emit failed", e);
  }
};

export const emitLeadStale = async (enrollmentId: string) => {
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "enrollment/lead.stale",
      data: { enrollmentId },
    });
  } catch {
    /* optional */
  }
};

export const emitCampaignRun = async (campaignId: string) => {
  if (!shouldEmitInngest()) return;
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "notification/campaign.run",
      data: { campaignId },
    });
  } catch (e) {
    console.warn("[inngest] notification/campaign.run emit failed", e);
  }
};

/** Envío directo sin Inngest (p. ej. pago sin claves aún). */
export const runPaymentConfirmationNow = async (enrollmentId: string) => {
  const { sendPaymentConfirmation } = await import(
    "../notifications/payment-confirmation"
  );
  return sendPaymentConfirmation(enrollmentId);
};
