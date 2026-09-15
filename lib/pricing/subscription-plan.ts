/**
 * ¿Este producto cobra por un plan recurrente de algún proveedor? Sin
 * dependencias de servidor, para poder usarlo también en el CRM (cliente).
 */
export const hasSubscriptionPlan = (product: {
  paypalPlanId?: string | null;
  mercadoPagoPreapprovalPlanId?: string | null;
}): boolean =>
  Boolean(product.paypalPlanId || product.mercadoPagoPreapprovalPlanId);
