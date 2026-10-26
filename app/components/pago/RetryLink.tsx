"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { readCheckoutOrigin } from "@/app/components/payments/checkoutOrigin";

type Props = {
  className: string;
  /** Texto cuando se sabe a dónde volver: lleva a la página donde se estaba pagando. */
  retryLabel: string;
  /** Texto cuando no se sabe (otra pestaña, sin almacenamiento). */
  fallbackLabel: string;
  /** A dónde lleva cuando no se sabe: las opciones, no un punto cualquiera. */
  fallbackHref: string;
};

// El origen vive en `sessionStorage`: no hay nada a lo que suscribirse y en el
// servidor no existe, de ahí `null` y que el primer pintado sea el del inicio.
const subscribe = () => () => {};
const getServerSnapshot = (): string | null => null;

/**
 * «Reintentar» de `/pago/cancelado` y `/pago/fallido`.
 *
 * Esas páginas llegan de PayPal o Mercado Pago sin saber qué compraba la
 * persona. Antes mandaban al cuestionario de terapias o a `/#servicios`, que no
 * es donde estaba quien pagaba un curso, un taller o el enlace que le mandó
 * Dayana. `startCheckout` anota la página de origen al salir; aquí se lee.
 */
const RetryLink = ({ className, retryLabel, fallbackLabel, fallbackHref }: Props) => {
  const origin = useSyncExternalStore(subscribe, readCheckoutOrigin, getServerSnapshot);
  return (
    <Link href={origin ?? fallbackHref} className={className}>
      {origin ? retryLabel : fallbackLabel}
    </Link>
  );
};

export default RetryLink;
