"use client";

import { useEffect, useRef } from "react";

/**
 * Un solo stream por pestaña para toda la sección de WhatsApp (menú, lista,
 * chat abierto, estado). Cada stream abierto es una función viva en Vercel;
 * uno por componente sería pagar varias veces por la misma información.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const ensure = () => {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/admin/whatsapp/stream");
  source.onmessage = () => listeners.forEach((l) => l());
};

const release = () => {
  if (listeners.size > 0) return;
  // Al cambiar de página dentro de la sección, el siguiente componente se
  // suscribe enseguida: se espera un momento antes de cerrar.
  closeTimer = setTimeout(() => {
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  }, 1500);
};

/** Llama a `onChange` cuando entra un mensaje o la IA avanza un paso. */
export const useWhatsAppLive = (onChange: () => void) => {
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  });
  useEffect(() => {
    const listener = () => ref.current();
    listeners.add(listener);
    ensure();
    return () => {
      listeners.delete(listener);
      release();
    };
  }, []);
};
