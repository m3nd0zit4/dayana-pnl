"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { TYPING_DELAY, useSettings } from "./context";
import SettingRow, { SettingsGroup } from "./SettingRow";
import ToggleRow, { WaSwitch } from "./ToggleRow";

/**
 * Pagos por fuera de la web: las cuentas que la asistente comparte cuando se
 * las piden (el texto sale tal cual: la IA nunca escribe un número de cuenta),
 * si reenvía el enlace de pago que creaste y si recibe los comprobantes.
 */
const PaymentsSection = () => {
  const { config, change, states } = useSettings();
  const pay = config.payments;
  const methods = pay.methods;

  const setMethods = (next: typeof methods, delay = 0) => change("wa-pay-methods", "payments.methods", next, delay);
  const setMethod = (index: number, patch: Partial<(typeof methods)[number]>, delay = 0) =>
    setMethods(
      methods.map((m, i) => (i === index ? { ...m, ...patch } : m)),
      delay
    );
  const add = () =>
    setMethods([
      ...methods,
      { key: `pago-${Date.now().toString(36)}`, label: "Nueva forma de pago", when: "", details: "Escribe aquí los datos tal como se envían.", enabled: false },
    ]);

  return (
    <SettingsGroup
      title="Pagos por WhatsApp"
      description="Transferencias, Western Union, Global66, Remitly: lo que la asistente comparte cuando la persona quiere pagar, y los comprobantes que recibe."
    >
      <ToggleRow
        id="wa-pay-receipts"
        label="Recibir comprobantes"
        help="Cuando llega un comprobante, la IA lo mira, le contesta que lo revisas y te avisa. Tú lo confirmas en el chat y la persona queda como contacto y clienta."
        info="Si ve un problema (transferencia rechazada, otra cuenta, un monto que no cuadra) se lo explica con calma y te lo marca."
        state={states["wa-pay-receipts"]}
        checked={pay.receipts}
        onChange={(v) => change("wa-pay-receipts", "payments.receipts", v)}
      />
      <ToggleRow
        id="wa-pay-links"
        label="Reenviar el enlace de pago que creaste"
        help="Si le creaste un enlace de pago a esa persona y lo pide, se lo vuelve a mandar. La IA no crea enlaces nuevos."
        state={states["wa-pay-links"]}
        checked={pay.sendLinks}
        onChange={(v) => change("wa-pay-links", "payments.sendLinks", v)}
      />
      <SettingRow
        id="wa-pay-methods"
        layout="stacked"
        label="Formas de pago"
        help="El texto va tal cual, debajo del mensaje de la IA. «A quién va» le dice cuál mandar (p. ej. «Colombia», «Fuera de Colombia», «Solo si la pide»)."
        state={states["wa-pay-methods"]}
      >
        <ul className="space-y-4">
          {methods.map((m, i) => (
            <li key={m.key} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Nombre de la forma de pago"
                  defaultValue={m.label}
                  className="flex-1"
                  onChange={(e) => {
                    const label = e.target.value.trim();
                    if (label.length >= 2) setMethod(i, { label }, TYPING_DELAY);
                  }}
                />
                <WaSwitch aria-label={`Usar ${m.label}`} checked={m.enabled} onCheckedChange={(v) => setMethod(i, { enabled: v })} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar ${m.label}`}
                  onClick={() => setMethods(methods.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Input
                aria-label="A quién va"
                placeholder="A quién va: Colombia, Fuera de Colombia…"
                defaultValue={m.when}
                onChange={(e) => setMethod(i, { when: e.target.value.trim().slice(0, 120) }, TYPING_DELAY)}
              />
              <Textarea
                aria-label="Datos que se envían"
                rows={5}
                defaultValue={m.details}
                onChange={(e) => {
                  const details = e.target.value.trim();
                  if (details.length >= 5) setMethod(i, { details: details.slice(0, 800) }, TYPING_DELAY);
                }}
              />
            </li>
          ))}
        </ul>
        {methods.length < 8 && (
          <Button variant="outline" size="sm" className="mt-3" onClick={add}>
            <Plus className="size-4" /> Agregar forma de pago
          </Button>
        )}
      </SettingRow>
    </SettingsGroup>
  );
};

export default PaymentsSection;
