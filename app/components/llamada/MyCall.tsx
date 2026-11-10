"use client";

import type { ReactNode } from "react";
import { CalendarPlus, Clock, Phone } from "lucide-react";

import type { FunnelPage } from "@/lib/crm/call-funnel/server";

import { MyCallChange } from "./MyCallChange";
import { MyCallConfirm } from "./MyCallConfirm";
import { useRememberToken } from "./MyCallHooks";
import { MyCallSaveLink } from "./MyCallSaveLink";
import { body, eyebrow, h1, h2, secondaryBtn, surface, tapLink } from "./MyCallUi";
import { MyCallWhen } from "./MyCallWhen";

type Props = {
  token: string;
  page: FunnelPage;
  /** Su llamada (la página solo monta esta pieza con una cita por delante). */
  call: NonNullable<FunnelPage["call"]>;
  /** «Qué va a pasar»: texto fijo que la página pinta en el servidor. */
  children?: ReactNode;
};

/**
 * La página de quien ya tiene su llamada (`stage: "agendada"`). Aquí aterriza
 * justo después de elegir la hora y aquí vuelve desde su enlace guardado, así
 * que el orden es el de lo que hace que la persona llegue a la cita: el hecho
 * (cuándo es, en SU hora), confirmar, apuntarla en el calendario, saber qué va
 * a pasar; cambiar o cancelar queda al final y a un toque.
 *
 * Nunca muestra el teléfono ni las respuestas: `FunnelPage` no los trae.
 */
const MyCall = ({ token, page, call, children }: Props) => {
  const fallbackTz = page.personTz ?? page.dayanaTz;
  useRememberToken(token);

  return (
    <>
      <p className={eyebrow}>Tu llamada gratis</p>
      <h1 className={`mt-4 ${h1}`}>{page.firstName}, tu llamada está agendada</h1>

      <div className={`mt-8 p-5 sm:p-8 ${surface}`}>
        <MyCallWhen startIso={call.startIso} fallbackTz={fallbackTz} dayanaTz={page.dayanaTz} />
        <ul className="mt-6 flex flex-col gap-2.5 border-t border-foreground/10 pt-5 font-[font1] text-base leading-snug">
          <li className="flex items-start gap-3">
            <Phone className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Dayana te llama por WhatsApp a esa hora
          </li>
          <li className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {`Dura ${call.minutes} minutos`}
          </li>
        </ul>
      </div>

      {page.confirmUrl ? <MyCallConfirm token={token} confirmUrl={page.confirmUrl} confirmed={page.confirmed} /> : null}

      {page.googleCalendarUrl || page.icsPath ? (
        <section aria-labelledby="mi-llamada-calendario" className="mt-10">
          <h2 id="mi-llamada-calendario" className={h2}>
            Añadir a mi calendario
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {page.googleCalendarUrl ? (
              <a href={page.googleCalendarUrl} target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
                <CalendarPlus className="size-4 shrink-0" aria-hidden="true" />
                Google Calendar
              </a>
            ) : null}
            {page.icsPath ? (
              <a href={page.icsPath} download className={secondaryBtn}>
                <CalendarPlus className="size-4 shrink-0" aria-hidden="true" />
                Apple / Outlook
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {children}

      {page.canChange ? (
        <MyCallChange token={token} startIso={call.startIso} fallbackTz={fallbackTz} helpUrl={page.helpUrl} />
      ) : (
        // La llamada ya empezó: no se puede mover ni cancelar desde aquí.
        <section aria-labelledby="mi-llamada-ahora" className="mt-12 border-t border-foreground/10 pt-10">
          <h2 id="mi-llamada-ahora" className={h2}>
            Tu llamada es ahora
          </h2>
          <p className={`mt-2 ${body}`}>Ten tu WhatsApp a la mano: Dayana te llama desde su número.</p>
          <a href={page.helpUrl} target="_blank" rel="noopener noreferrer" className={`mt-2 ${tapLink}`}>
            Si no te ha entrado la llamada, escríbele por WhatsApp
          </a>
        </section>
      )}

      <MyCallSaveLink token={token} />
    </>
  );
};

export default MyCall;
