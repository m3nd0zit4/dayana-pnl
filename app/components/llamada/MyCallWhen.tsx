"use client";

import { dayLabel, timeLabel, whenLabel } from "@/lib/crm/call-funnel/rules";
import { getSchedulePlaceLabel } from "@/lib/datetime/visitor-schedule";

import { useViewerZone } from "./MyCallHooks";

type Props = {
  startIso: string;
  /** La zona con la que pinta el servidor: la que dio al registrarse o, si no, la de Dayana. */
  fallbackTz: string;
  dayanaTz: string;
  /** `hero`: la fecha y la hora en grande. `line`: una sola línea (la llamada que ya pasó). */
  variant?: "hero" | "line";
};

const capitalize = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/**
 * Cuándo es la llamada, en la zona de quien mira.
 *
 * El servidor la pinta en `fallbackTz` y el navegador la corrige a la suya
 * justo después de hidratar (`useViewerZone`): la hora se ve desde el primer
 * byte, sin hueco, y siempre va con el nombre de la zona al lado, así que el
 * dato es cierto antes y después del cambio.
 *
 * `suppressHydrationWarning` en cada texto que sale de `Intl`: el servidor
 * (Node) y el navegador pueden escribir la misma hora con otro espacio
 * («4:15 p. m.» con espacio fino o normal). El contenido es el mismo.
 */
export const MyCallWhen = ({ startIso, fallbackTz, dayanaTz, variant = "hero" }: Props) => {
  const zone = useViewerZone(fallbackTz);
  const when = whenLabel(startIso, zone);
  const place = getSchedulePlaceLabel(zone);
  const dayanaWhen = whenLabel(startIso, dayanaTz);
  // Se compara lo que se lee, no el nombre de la zona: Lima y Bogotá marcan la
  // misma hora, y repetirla debajo solo estorba.
  const showDayana = when !== dayanaWhen;
  const dayanaLine = `${capitalize(getSchedulePlaceLabel(dayanaTz))}: ${dayanaWhen}`;

  if (variant === "line") {
    return (
      <p suppressHydrationWarning className="font-[font1] text-[15px] leading-relaxed text-muted-foreground">
        {`Tu llamada era el ${when} (${place}).`}
      </p>
    );
  }

  return (
    <div>
      <p suppressHydrationWarning className="font-[font2] text-xl leading-tight sm:text-2xl">
        {capitalize(dayLabel(startIso, zone))}
      </p>
      {/* Alto fijo de una línea: al corregir la zona cambian los dígitos, no la caja. */}
      <p
        suppressHydrationWarning
        className="mt-2 whitespace-nowrap font-[font2] text-[clamp(2.4rem,12vw,4.5rem)] leading-none tracking-tight tabular-nums"
      >
        {timeLabel(startIso, zone)}
      </p>
      <p suppressHydrationWarning className="mt-3 font-[font1] text-sm leading-snug text-muted-foreground">
        {capitalize(place)}
      </p>
      {showDayana ? (
        <p suppressHydrationWarning className="mt-1 font-[font1] text-sm leading-snug text-muted-foreground">
          {dayanaLine}
        </p>
      ) : null}
    </div>
  );
};
