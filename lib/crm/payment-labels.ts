import type { PaymentProvider, PaymentStatus } from "@prisma/client";

/**
 * Etiquetas de pagos y suscripciones, una sola fuente para el CRM, el CSV,
 * Estadísticas, el recibo y la factura del miembro. Importa sólo tipos de
 * Prisma, así que se puede usar desde componentes de cliente.
 */

/** Corta, para listas y filtros del CRM. */
export const PAYMENT_PROVIDER_LABEL: Record<PaymentProvider, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Manual",
};

/** Larga, para textos que lee alguien fuera del CRM (recibo, factura, historial). */
export const PAYMENT_PROVIDER_LONG_LABEL: Record<PaymentProvider, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Registro manual",
};

/** Para valores sin tipar (filas de SQL, DTO serializados): cae al valor crudo. */
export const paymentProviderLabel = (provider: string): string =>
  PAYMENT_PROVIDER_LABEL[provider as PaymentProvider] ?? provider;

export const paymentProviderLongLabel = (provider: string): string =>
  PAYMENT_PROVIDER_LONG_LABEL[provider as PaymentProvider] ?? provider;

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  FAILED: "Fallido",
  REFUNDED: "Reembolsado",
};

/** Estado de la suscripción en el proveedor (`Enrollment.subscriptionStatus`). */
export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activa",
  SUSPENDED: "Suspendida",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

export const subscriptionStatusLabel = (status: string): string =>
  SUBSCRIPTION_STATUS_LABEL[status] ?? status;
