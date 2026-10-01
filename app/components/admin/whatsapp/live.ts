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
let wakeHooked = false;
let lastWake = 0;

/**
 * Al volver a la pestaña (el celular la duerme en cuanto se bloquea o se
 * cambia de app): si el stream murió se abre otro, y se pide lo que cambió
 * mientras tanto — sin esto la lista se quedaba como estaba al irse.
 */
const onWake = () => {
  if (document.visibilityState !== "visible" || listeners.size === 0) return;
  const now = Date.now();
  if (now - lastWake < 1500) return;
  lastWake = now;
  if (source && source.readyState === EventSource.CLOSED) {
    source.close();
    source = null;
  }
  ensure();
  listeners.forEach((l) => l());
};

const ensure = () => {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (typeof window === "undefined") return;
  if (!wakeHooked) {
    wakeHooked = true;
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
  }
  if (source) return;
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
