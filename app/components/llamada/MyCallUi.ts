import { textLink } from "./styles";

/**
 * Las clases de `/llamada/<token>` (la página de quien ya se registró). Los
 * botones son los del embudo (`styles.ts`, los mismos del selector de horas que
 * esta página incrusta); aquí solo está lo propio de esta página. Todo con
 * tokens de `app/globals.css` y las dos fuentes de la marca.
 *
 * Sin `"use client"`: lo importan la página (servidor) y las piezas del navegador.
 */

export { primaryBtn, secondaryBtn } from "./styles";

/** Para lo que cancela: la forma del botón secundario, en el color de error. */
export const dangerBtn =
  "inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full border border-destructive/40 bg-paper/70 px-6 py-3 text-center font-[font2] text-sm leading-tight text-destructive outline-none transition-colors hover:border-destructive hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-destructive/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-55";

/** Un enlace suelto (no dentro de un párrafo): con zona de toque de 44 px. */
export const tapLink = `inline-flex min-h-11 items-center font-[font1] text-[15px] leading-snug disabled:opacity-55 ${textLink}`;

export const eyebrow = "font-[font2] text-[11px] uppercase tracking-[0.28em] text-primary";

export const h1 = "font-[font2] text-[clamp(1.9rem,7.4vw,3rem)] uppercase leading-[0.98] tracking-tight text-balance";

export const h2 = "font-[font2] text-lg uppercase leading-tight tracking-[0.02em]";

export const lead = "font-[font1] text-lg leading-snug text-foreground/80";

export const body = "font-[font1] text-[15px] leading-relaxed text-muted-foreground";

/** La superficie de la cita y de lo que se abre (el selector de horas, cancelar). */
export const surface = "rounded-3xl border border-foreground/10 bg-card";
