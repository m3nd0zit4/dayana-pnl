import type { ReactNode } from "react";

/**
 * Un bloque de la cuenta: título, una línea que explica para qué sirve, y el
 * formulario.
 *
 * Sustituye al `Card`/`CardContent` de shadcn que se usaba aquí. No es un
 * capricho: `/cuenta` se sirve con la cabecera del sitio y su tipografía
 * —`font-[font2]` en versales, crema de fondo—, y las tarjetas del panel
 * traían la escala tipográfica del CRM, así que la página parecía media
 * pantalla de marketing y media pantalla de herramienta interna.
 *
 * `tone="danger"` es para lo que no tiene vuelta atrás. Se distingue por el
 * borde y no por un fondo rojo: la sección se lee igual de bien, pero no grita
 * antes de que nadie haya pedido nada.
 */
const CuentaSection = ({
  title,
  description,
  tone = "default",
  children,
}: {
  title: string;
  description?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) => (
  <section
    className={`rounded-3xl border bg-white/60 p-6 sm:p-8 ${
      tone === "danger" ? "border-destructive/30" : "border-black/10"
    }`}
  >
    <h2 className="font-[font2] text-lg uppercase leading-tight">{title}</h2>
    {description && (
      <p className="mt-2 font-[font1] text-[15px] leading-relaxed text-black/60">
        {description}
      </p>
    )}
    <div className="mt-6">{children}</div>
  </section>
);

export default CuentaSection;
