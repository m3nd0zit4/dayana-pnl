import {
  ApplicationContextUserAction,
  Client,
  Environment,
  ExperienceContextShippingPreference,
  LogLevel,
  SubscriptionsController,
} from "@paypal/paypal-server-sdk";

/**
 * Suscripciones de PayPal (Billing Plans), sobre `@paypal/paypal-server-sdk`.
 *
 * Aquí sí se usa el SDK y en `lib/paypal/server.ts` no: esto es código nuevo,
 * así que no hay nada que romper, y es donde el SDK aporta de verdad —
 * crear/consultar/cancelar suscripciones son varios endpoints con cuerpos que
 * a mano hay que acertar de memoria. La creación y captura de órdenes seguirá
 * a mano hasta que esto esté estable: migrar lo que ya cobra mientras se añade
 * función nueva mezcla dos riesgos en un mismo despliegue.
 *
 * Ojo: el SDK **no** verifica firmas de webhooks. Eso sigue en
 * `lib/webhooks/verify.ts`, contra la API de PayPal.
 */

const isLive = (): boolean =>
  process.env.PAYPAL_MODE?.toLowerCase() === "live";

let cached: Client | null = null;

export const paypalClient = (): Client => {
  if (cached) return cached;

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET. Set them in .env."
    );
  }

  cached = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
    // Mismo interruptor que el resto de la integración: una sola variable
    // decide el entorno, para que no puedan quedar desparejados.
    environment: isLive() ? Environment.Production : Environment.Sandbox,
    logging: {
      logLevel: LogLevel.Error,
      logRequest: { logBody: false },
      logResponse: { logHeaders: false },
    },
  });
  return cached;
};

export const subscriptionsApi = (): SubscriptionsController =>
  new SubscriptionsController(paypalClient());

export type CreateSubscriptionInput = {
  planId: string;
  /** Referencia de checkout (contacto + plan), firmada. */
  checkoutReference: string;
  returnUrl: string;
  cancelUrl: string;
  /** Correo de la compradora si ya se conoce; PayPal lo pide igual si falta. */
  subscriberEmail?: string;
};

export type CreatedSubscription = {
  id: string;
  approveUrl?: string;
};

/**
 * Crea la suscripción y devuelve a dónde mandar a la compradora.
 *
 * El enlace se busca como `payer-action` **y** como `approve`: PayPal usa uno u
 * otro según el camino, y leer sólo el primero deja el botón sin destino — es
 * exactamente la regresión que ya mordió en `lib/paypal/server.ts`.
 */
export const createPayPalSubscription = async (
  input: CreateSubscriptionInput
): Promise<CreatedSubscription> => {
  const { result } = await subscriptionsApi().createSubscription({
    body: {
      planId: input.planId,
      customId: input.checkoutReference.slice(0, 127),
      applicationContext: {
        brandName: "Dayana Beltran PNL",
        userAction: ApplicationContextUserAction.SubscribeNow,
        // El SDK rechazó "NO_SHIPPING_ADDRESS", que es lo que parecía por el
        // nombre del campo: el valor real es NO_SHIPPING. Ese es justo el tipo
        // de error que a mano se descubre en la pasarela y no en el editor.
        shippingPreference: ExperienceContextShippingPreference.NoShipping,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
      },
      ...(input.subscriberEmail
        ? { subscriber: { emailAddress: input.subscriberEmail } }
        : {}),
    },
  });

  const links = result.links ?? [];
  const approveUrl =
    links.find((l) => l.rel === "approve")?.href ??
    links.find((l) => l.rel === "payer-action")?.href;

  if (!result.id) throw new Error("PayPal no devolvió id de suscripción");
  return { id: result.id, approveUrl };
};

export const getPayPalSubscription = async (subscriptionId: string) => {
  const { result } = await subscriptionsApi().getSubscription({ id: subscriptionId });
  return result;
};

/**
 * Detiene la renovación. NO devuelve dinero ni recorta el acceso ya pagado:
 * `Enrollment.paidUntil` manda, y cerrar antes de esa fecha sería quedarse el
 * dinero de un servicio no prestado.
 */
export const cancelPayPalSubscription = async (
  subscriptionId: string,
  reason: string
): Promise<void> => {
  await subscriptionsApi().cancelSubscription({
    id: subscriptionId,
    body: { reason: reason.slice(0, 128) },
  });
};
