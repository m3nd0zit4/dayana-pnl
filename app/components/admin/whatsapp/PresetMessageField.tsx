"use client";

import { MENSAJE_MAX } from "@/lib/crm/event-template-vars";

/**
 * «Tu mensaje»: las palabras de Dayana en la invitación con horarios. Va en
 * {{mensaje}}, así que es una sola línea (WhatsApp no deja saltos dentro de
 * una variable) de hasta 300 caracteres.
 */
const PresetMessageField = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
  <label className="block space-y-1">
    <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">Tu mensaje</span> (va después de «Hola …,», en una sola línea)
      </span>
      <span className={value.length >= MENSAJE_MAX ? "text-destructive" : undefined}>
        {value.length}/{MENSAJE_MAX}
      </span>
    </span>
    <input
      type="text"
      value={value}
      maxLength={MENSAJE_MAX}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n\t]+/g, " "))}
      placeholder="te invito a una clase en vivo para soltar lo que ya no te sirve."
      className="h-10 w-full rounded-lg border border-border bg-card px-2.5 text-base outline-none focus:border-[#00a884] md:h-9 md:text-sm"
    />
  </label>
);

export default PresetMessageField;
