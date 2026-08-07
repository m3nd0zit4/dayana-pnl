"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";

/** Fila serializable — la página la aplana antes de pasarla al cliente. */
export type WebinarRegistrantRow = {
  id: string;
  contactId: string;
  name: string;
  email: string | null;
  phoneE164: string | null;
  notifyEmail: boolean;
  createdAtIso: string;
  linkEmailSentAt: string | null;
  reminder24hSentAt: string | null;
  reminder1hSentAt: string | null;
};

type Props = {
  registrations: WebinarRegistrantRow[];
};

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
  });

const SentMark = ({ at, label }: { at: string | null; label: string }) =>
  at ? (
    <span
      title={`${label}: ${new Date(at).toLocaleString("es-CO")}`}
      className="inline-flex items-center gap-1 text-emerald-700"
    >
      <Check className="size-3.5" />
      <span className="sr-only">{label} enviado</span>
    </span>
  ) : (
    <span title={`${label}: sin enviar`} className="text-black/25">
      <Minus className="size-3.5" />
      <span className="sr-only">{label} sin enviar</span>
    </span>
  );

/**
 * Quién se registró y qué correos le han llegado.
 *
 * Solo lectura: reenviar «a una sola persona» no existe a propósito — cambiar
 * el enlace ya devuelve a todo el mundo a la cola, que es el caso real.
 */
const WebinarRegistrantsPanel = ({ registrations }: Props) => {
  const withoutEmail = registrations.filter((r) => !r.email).length;

  return (
    <Card className="border-black/8 bg-white/80">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base uppercase tracking-wide">
          Registradas
        </CardTitle>
        <span className="rounded-full bg-black/[0.06] px-2.5 py-0.5 text-xs font-medium text-black/60">
          {registrations.length}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {registrations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía nadie se ha registrado.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-black/8 text-left text-[11px] uppercase tracking-wider text-black/40">
                    <th className="pb-2 font-medium">Persona</th>
                    <th className="pb-2 font-medium">Registro</th>
                    <th className="pb-2 text-center font-medium">Enlace</th>
                    <th className="pb-2 text-center font-medium">24 h</th>
                    <th className="pb-2 text-center font-medium">1 h</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-black/5 last:border-0"
                    >
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/admin/contacts/${r.contactId}`}
                          className="font-medium text-black/80 hover:text-terracotta"
                        >
                          {r.name}
                        </Link>
                        <div className="mt-0.5 text-xs text-black/45">
                          {r.email ? (
                            r.notifyEmail ? (
                              r.email
                            ) : (
                              <span className="text-amber-700">
                                {r.email} · baja de correo
                              </span>
                            )
                          ) : (
                            <span className="text-amber-700">sin correo</span>
                          )}
                          {r.phoneE164 ? ` · ${r.phoneE164}` : ""}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-black/55">
                        {shortDate(r.createdAtIso)}
                      </td>
                      <td className="py-2.5 text-center">
                        <SentMark at={r.linkEmailSentAt} label="Enlace" />
                      </td>
                      <td className="py-2.5 text-center">
                        <SentMark
                          at={r.reminder24hSentAt}
                          label="Recordatorio 24 h"
                        />
                      </td>
                      <td className="py-2.5 text-center">
                        <SentMark
                          at={r.reminder1hSentAt}
                          label="Recordatorio 1 h"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {withoutEmail > 0 ? (
              <p className="text-xs text-amber-700">
                {withoutEmail} sin correo: no reciben ni el enlace ni los
                recordatorios. Escríbeles por WhatsApp desde su ficha.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default WebinarRegistrantsPanel;
