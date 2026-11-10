/**
 * Las clases que comparten el formulario de la llamada gratis y el selector de
 * horas. Solo tokens de `globals.css`: el botón principal va en `--primary`
 * (marrón) y no en terracota porque el texto blanco sobre terracota no llega al
 * contraste 4.5:1 en letra de este tamaño; la terracota queda para los acentos.
 */

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card";

export const primaryBtn = `inline-flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full bg-primary px-7 py-3.5 text-center font-[font2] text-base leading-tight text-primary-foreground transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-primary ${focusRing}`;

export const secondaryBtn = `inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full border border-foreground/20 bg-paper/70 px-6 py-3 text-center font-[font2] text-sm leading-tight text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-55 ${focusRing}`;

/** Un enlace dentro de un texto: subrayado y en marrón (la terracota no llega a 4.5:1 sobre crema). */
export const textLink =
  "rounded-sm text-primary underline decoration-primary/40 underline-offset-[3px] outline-none transition-colors hover:decoration-primary focus-visible:ring-2 focus-visible:ring-primary/60";

/**
 * La tarjeta de una opción (radio oculto con `peer sr-only` + este `span`):
 * día, hora, tema, urgencia. Mínimo 52 px de alto para el dedo. La fuente la
 * pone quien la usa (`font-[font1]` o `font-[font2]`).
 */
export const optionBox =
  "flex min-h-13 cursor-pointer items-center rounded-xl border border-input bg-paper/70 px-4 py-2.5 text-base leading-snug text-foreground transition-colors hover:border-primary/50 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-primary/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card peer-disabled:cursor-not-allowed peer-disabled:opacity-50";

/** La tarjeta del formulario (y la del botón de WhatsApp cuando la página está cerrada). */
export const funnelCard =
  "relative scroll-mt-4 rounded-3xl border border-border bg-card p-5 shadow-xl shadow-primary/10 sm:p-7";
