"use client";

import { useState } from "react";

import { buildWhatsAppUrl } from "@/lib/contact";

/**
 * Botón de cancelar, con su confirmación en la misma pantalla.
 *
 * Cancelar es irreversible —el hueco se libera y el evento se borra del
 * calendario—, así que no se hace con un solo toque desde un correo que
 * pudo abrirse sin querer.
 */
const CancelAppointment = ({
  token,
  alreadyCancelled,
  whatsappNumber,
}: {
  token: string;
  alreadyCancelled: boolean;
  whatsappNumber: string;
}) => {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(alreadyCancelled);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const cancel = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/agenda/cancelar/${token}`, { method: "POST" });
      if (!res.ok) {
        setError("No se pudo cancelar. Escríbeme por WhatsApp y lo hago yo.");
        return;
      }
      setDone(true);
    } catch {
      setError("Error de red. Intenta de nuevo.");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="mt-6">
        <p className="font-[font1] text-base leading-snug text-black/70">
          Cita cancelada. El espacio queda libre para alguien más.
        </p>
        <a
          href={buildWhatsAppUrl("Hola Dayana, quiero agendar otra hora.")}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block font-[font1] text-sm text-terracotta underline underline-offset-2"
        >
          Escribir por WhatsApp ({whatsappNumber})
        </a>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {error && (
        <p role="alert" className="mb-3 font-[font1] text-sm text-red-600">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="font-[font1] text-sm text-black/60">
            ¿Seguro? Se libera el espacio y se borra de la agenda.
          </p>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={sending}
            className="w-full cursor-pointer rounded-full bg-[#141118] px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.28em] text-linen disabled:opacity-60"
          >
            {sending ? "Cancelando…" : "Sí, cancelar"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="w-full cursor-pointer rounded-full border border-black/15 px-6 py-3 font-[font1] text-sm text-black/60"
          >
            Mejor la mantengo
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full cursor-pointer rounded-full border border-black/20 px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.28em] text-black/70 transition-colors hover:border-black/40 hover:text-black"
        >
          Cancelar la cita
        </button>
      )}
    </div>
  );
};

export default CancelAppointment;
