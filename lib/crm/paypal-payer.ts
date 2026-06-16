export type PayPalPayerInfo = {
  email?: string;
  firstName?: string;
  lastName?: string;
};

/** Extract payer details from PayPal order capture or webhook resource payload. */
export const extractPayPalPayer = (payload: unknown): PayPalPayerInfo => {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as {
    payer?: {
      email_address?: string;
      name?: { given_name?: string; surname?: string };
    };
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          payer?: {
            email_address?: string;
            name?: { given_name?: string; surname?: string };
          };
        }>;
      };
    }>;
  };

  const payer =
    p.payer ??
    p.purchase_units?.[0]?.payments?.captures?.[0]?.payer;

  if (!payer) return {};

  return {
    email: payer.email_address?.trim() || undefined,
    firstName: payer.name?.given_name?.trim() || undefined,
    lastName: payer.name?.surname?.trim() || undefined,
  };
};
