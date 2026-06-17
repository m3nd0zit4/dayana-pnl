import type { PayPalScriptOptions } from "@paypal/paypal-js";

export function buildPayPalScriptOptions(
  clientId: string,
  environment: "production" | "sandbox"
): PayPalScriptOptions {
  return {
    clientId,
    currency: "USD",
    intent: "capture",
    environment,
  };
}

function stringifyPayPalError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    if (typeof record.err === "string") return record.err;
    if (record.err instanceof Error) return record.err.message;
    if (typeof record.message === "string") return record.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "";
  }
}

/** SDK noise when popup/iframe closes while postMessage is in flight — not a payment failure. */
export function isBenignPayPalSdkError(err: unknown): boolean {
  const msg = stringifyPayPalError(err).toLowerCase();
  return (
    msg.includes("target window is closed") ||
    msg.includes("postrobot_method") ||
    msg.includes("popup close") ||
    msg.includes("window closed")
  );
}

export async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error("Respuesta vacía del servidor.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      "El servidor no devolvió JSON válido. Recarga la página e intenta de nuevo."
    );
  }
}

export type PayPalSdkConfig = {
  clientId: string;
  environment: "production" | "sandbox";
};

export async function fetchPayPalSdkConfig(): Promise<PayPalSdkConfig> {
  const res = await fetch("/api/paypal/sdk-config", { cache: "no-store" });
  const data = await readJsonResponse<PayPalSdkConfig & { message?: string }>(
    res
  );
  if (!res.ok || !data.clientId || !data.environment) {
    throw new Error(
      data.message ??
        "No se pudo cargar la configuración de PayPal. Revisa las variables de entorno."
    );
  }
  return { clientId: data.clientId, environment: data.environment };
}
