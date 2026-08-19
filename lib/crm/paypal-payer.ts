export type PayPalPayerInfo = {
  email?: string;
  firstName?: string;
  lastName?: string;
  /**
   * Teléfono tal como lo reporta PayPal, SIN normalizar.
   *
   * Sólo llega cuando "Número de teléfono de contacto" está activado en las
   * preferencias del sitio web de la cuenta de negocio; con la opción apagada
   * PayPal no lo pide y el campo no viene. Se deja crudo a propósito: quien
   * escribe en el CRM lo normaliza con `lib/phone.ts`, que es donde vive esa
   * responsabilidad.
   */
  phone?: string;
  /** ISO-3166-1 alpha-2 de la dirección del pagador, si la manda. */
  countryIso?: string;
};

type PayerShape = {
  email_address?: string;
  payer_id?: string;
  name?: { given_name?: string; surname?: string };
  phone?: {
    phone_number?: { national_number?: string };
    phone_type?: string;
  };
  address?: { country_code?: string };
};

const joinPhone = (payer: PayerShape): string | undefined => {
  const national = payer.phone?.phone_number?.national_number?.trim();
  return national || undefined;
};

/** Extract payer details from PayPal order capture or webhook resource payload. */
export const extractPayPalPayer = (payload: unknown): PayPalPayerInfo => {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as {
    payer?: PayerShape;
    /**
     * En un pago con tarjeta sin cuenta de PayPal no hay `payer` de wallet: la
     * persona aparece como `payee`/`card` dentro del capture. El nombre y la
     * dirección de facturación viajan en `payment_source.card`.
     */
    payment_source?: {
      card?: {
        name?: string;
        billing_address?: { country_code?: string };
      };
    };
    purchase_units?: Array<{
      payments?: { captures?: Array<{ payer?: PayerShape }> };
      shipping?: { address?: { country_code?: string } };
    }>;
  };

  const payer = p.payer ?? p.purchase_units?.[0]?.payments?.captures?.[0]?.payer;

  if (!payer) {
    // Camino de tarjeta sin cuenta: se rescata lo poco que sí viene.
    const card = p.payment_source?.card;
    if (!card) return {};
    const parts = card.name?.trim().split(/\s+/) ?? [];
    return {
      firstName: parts[0] || undefined,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
      countryIso: card.billing_address?.country_code?.trim() || undefined,
    };
  }

  return {
    email: payer.email_address?.trim() || undefined,
    firstName: payer.name?.given_name?.trim() || undefined,
    lastName: payer.name?.surname?.trim() || undefined,
    phone: joinPhone(payer),
    countryIso:
      payer.address?.country_code?.trim() ||
      p.purchase_units?.[0]?.shipping?.address?.country_code?.trim() ||
      undefined,
  };
};
