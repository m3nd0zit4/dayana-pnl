import { CHECKOUT_ORIGIN_KEY, safeCheckoutOrigin } from "@/lib/checkout-origin";

/**
 * Anota desde qué página se inicia el pago, justo antes de salir hacia PayPal o
 * Mercado Pago. `/pago/cancelado` y `/pago/fallido` la leen al volver para
 * ofrecer «reintentar» donde la persona estaba. Ver `lib/checkout-origin.ts`.
 *
 * Si la página no es de las que se validan, se borra lo que hubiera: un origen
 * viejo sería peor que ninguno. Sin almacenamiento (modo privado, bloqueado) no
 * pasa nada: la página de retorno cae en su enlace por defecto.
 */
export const rememberCheckoutOrigin = (): void => {
  try {
    const origin = safeCheckoutOrigin(window.location.pathname);
    if (origin) window.sessionStorage.setItem(CHECKOUT_ORIGIN_KEY, origin);
    else window.sessionStorage.removeItem(CHECKOUT_ORIGIN_KEY);
  } catch {
    // sin almacenamiento: se usa el enlace por defecto
  }
};

export const readCheckoutOrigin = (): string | null => {
  try {
    return safeCheckoutOrigin(window.sessionStorage.getItem(CHECKOUT_ORIGIN_KEY));
  } catch {
    return null;
  }
};
