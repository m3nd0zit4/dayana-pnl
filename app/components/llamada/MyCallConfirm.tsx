"use client";

import { useState } from "react";
import { Check, MessageCircle } from "lucide-react";

import { body, h2, primaryBtn, secondaryBtn } from "./MyCallUi";

type Props = {
  token: string;
  /** wa.me con el mensaje de confirmación ya escrito. */
  confirmUrl: string;
  /** Ya le escribió a Dayana después de agendar, o ya tocó el botón. */
  confirmed: boolean;
};

/**
 * «Confirmar por WhatsApp»: la acción que más pesa en que la persona llegue a
 * su llamada. Es un enlace de verdad (sin `preventDefault`): si el aviso al
 * servidor falla, o el JavaScript no cargó, WhatsApp se abre igual.
 *
 * El aviso (`/confirmar`) solo deja la marca de que tocó el botón; el mensaje
 * lo manda ella desde su WhatsApp. Por eso al tocar no se dice «confirmada»:
 * se le recuerda enviar el mensaje. La próxima vez que abra la página el
 * servidor ya la da por confirmada.
 */
export const MyCallConfirm = ({ token, confirmUrl, confirmed }: Props) => {
  const [opened, setOpened] = useState(false);

  const noteClick = () => {
    setOpened(true);
    const url = `/api/llamada/${encodeURIComponent(token)}/confirmar`;
    try {
      if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
    } catch {
      // Sin `sendBeacon` (o bloqueado): va por `fetch`.
    }
    void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
  };

  if (confirmed) {
    return (
      <section aria-labelledby="mi-llamada-confirmada" className="mt-8">
        <div className="flex items-start gap-3.5">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
            <Check className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
          </span>
          <div>
            <h2 id="mi-llamada-confirmada" className={h2}>
              Ya confirmaste
            </h2>
            <p className={`mt-1.5 ${body}`}>Dayana sabe que ahí estarás. Si necesitas decirle algo antes de la llamada, escríbele.</p>
          </div>
        </div>
        <a href={confirmUrl} target="_blank" rel="noopener noreferrer" className={`mt-5 ${secondaryBtn}`}>
          <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
          Escribirle a Dayana
        </a>
      </section>
    );
  }

  return (
    <section aria-label="Confirmar la llamada" className="mt-8">
      <a href={confirmUrl} target="_blank" rel="noopener noreferrer" onClick={noteClick} className={primaryBtn}>
        <MessageCircle className="size-5 shrink-0" aria-hidden="true" />
        Confirmar por WhatsApp
      </a>
      <p role="status" className={`mt-3 ${body}`}>
        {opened
          ? "Se abrió WhatsApp con el mensaje escrito: envíalo y tu llamada queda confirmada."
          : "Así Dayana sabe que ahí estarás y puede escribirte por WhatsApp."}
      </p>
    </section>
  );
};
