/**
 * Sent as `clientContext` when the operator types instead of answering a
 * pending approval card: the panel denies the card in the same send (eve would
 * otherwise hold the message until the card is answered). Shared with the eval
 * harness so it tests exactly what the panel sends.
 */
export const CORRECTION_CONTEXT =
  "El operador escribió en vez de aprobar la tarjeta pendiente: esa acción quedó cancelada. Aplica lo que pide ahora y, si corresponde, vuelve a proponerla corregida (nueva tarjeta), sin decir «Cancelado».";
