/**
 * Cliente REST de Lemon Squeezy.
 *
 * Sin SDK, igual que PayPal (`lib/paypal/server.ts`) y Mercado Pago: la API es
 * JSON:API plano y una dependencia más sólo para tres endpoints no se paga
 * sola. Ojo con los headers — LS exige `application/vnd.api+json` en Accept Y
 * en Content-Type; con `application/json` responde 406.
 */

const API_BASE = "https://api.lemonsqueezy.com/v1";

export class LemonSqueezyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string
  ) {
    super(message);
    this.name = "LemonSqueezyError";
  }
}

const apiKey = () => process.env.LEMONSQUEEZY_API_KEY?.trim();

export const lemonSqueezyStoreId = (): string | undefined =>
  process.env.LEMONSQUEEZY_STORE_ID?.trim();

/**
 * `true` sólo con la pasarela encendida Y credenciales presentes. El botón
 * público se controla aparte (NEXT_PUBLIC_…), así que el endpoint puede estar
 * vivo mientras la web todavía no lo muestra — así se verifica en producción
 * sin exponerlo. Ver el "rollout gate" del plan.
 */
export const isLemonSqueezyEnabled = (): boolean =>
  process.env.LEMONSQUEEZY_CHECKOUT_ENABLED === "true" &&
  Boolean(apiKey()) &&
  Boolean(lemonSqueezyStoreId());

export const lemonSqueezyRequest = async <T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> => {
  const key = apiKey();
  if (!key) throw new LemonSqueezyError("LEMONSQUEEZY_API_KEY is not set", 0);

  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${key}`,
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    // Los errores de LS vienen como { errors: [{ detail, title }] }.
    let detail: string | undefined;
    try {
      const parsed = JSON.parse(text) as {
        errors?: Array<{ detail?: string; title?: string }>;
      };
      detail = parsed.errors?.[0]?.detail ?? parsed.errors?.[0]?.title;
    } catch {
      detail = text.slice(0, 300);
    }
    throw new LemonSqueezyError(
      `Lemon Squeezy ${init?.method ?? "GET"} ${path} failed`,
      res.status,
      detail
    );
  }

  return JSON.parse(text) as T;
};
