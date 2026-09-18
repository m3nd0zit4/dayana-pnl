"use client";

import { useEffect } from "react";

/**
 * Registra el clic y salta a WhatsApp. Se registra desde el navegador y no en
 * el servidor al pedir la página: los escáneres de correo (Outlook, Gmail)
 * abren los enlaces solos para revisarlos, y contarlos marcaría como «fue a
 * WhatsApp» a quien nunca pulsó. Esos robots no ejecutan JavaScript.
 */
const WhatsAppHop = ({ code, target }: { code: string; target: string }) => {
  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.location.replace(target);
    };
    void fetch(`/api/w/${code}`, { method: "POST", keepalive: true })
      .catch(() => {})
      .finally(go);
    // Si el registro tarda, WhatsApp se abre igual.
    const timer = window.setTimeout(go, 1500);
    return () => window.clearTimeout(timer);
  }, [code, target]);

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-6 text-center text-ink">
      <p className="font-[font1] text-base">
        Abriendo WhatsApp…{" "}
        <a href={target} className="underline underline-offset-4">
          Toca aquí si no se abre
        </a>
      </p>
    </main>
  );
};

export default WhatsAppHop;
