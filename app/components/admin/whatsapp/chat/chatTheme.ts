/**
 * La paleta de WhatsApp del chat del CRM, clara y oscura, en un solo sitio.
 *
 * Los colores viven como variables CSS (`--wa-*`) que se declaran en la raíz
 * del chat con `WA_THEME` (clases de Tailwind con propiedades arbitrarias, así
 * que el modo oscuro del CRM —`.dark` en <html>— las cambia solo). Los
 * componentes usan las variables con la sintaxis de Tailwind 4:
 * `bg-(--wa-panel)`, `text-(--wa-meta)`, `bg-(--wa-text)/5`…
 *
 * Nada del chat debería escribir un `#hex` a mano: si falta un color, se
 * añade aquí con su versión oscura.
 */

/** Verde de WhatsApp (el mismo en los dos temas). */
export const WA_GREEN = "#00a884";

const LIGHT = [
  "[--wa-green:#00a884]",
  "[--wa-green-strong:#008069]",
  // Texto verde (enlaces «Ver ficha», títulos del panel).
  "[--wa-accent:#008069]",
  "[--wa-green-soft:#d9fdd3]",
  "[--wa-green-ink:#006e4f]",
  // Superficies
  "[--wa-surface:#ffffff]",
  "[--wa-panel:#f0f2f5]",
  "[--wa-chat-bg:#efeae2]",
  "[--wa-bubble-in:#ffffff]",
  "[--wa-bubble-out:#d9fdd3]",
  "[--wa-input:#ffffff]",
  "[--wa-hover:#f5f6f6]",
  "[--wa-active:#f0f2f5]",
  "[--wa-avatar:#dfe5e7]",
  // Texto
  "[--wa-text:#111b21]",
  "[--wa-heading:#41525d]",
  "[--wa-meta:#667781]",
  "[--wa-icon:#54656f]",
  "[--wa-link:#027eb5]",
  // Líneas
  "[--wa-border:#d1d7db]",
  "[--wa-divider:#e9edef]",
  // Estados
  "[--wa-tick:#8696a0]",
  "[--wa-read:#53bdeb]",
  "[--wa-unread:#25d366]",
  "[--wa-star:#f5b400]",
  "[--wa-danger:#d92d20]",
  "[--wa-danger-ink:#b42318]",
  "[--wa-danger-border:#f3b9b4]",
  "[--wa-danger-soft:#fef3f2]",
  "[--wa-blue:#1d4ed8]",
  "[--wa-blue-soft:#e7f0ff]",
  "[--wa-violet:#6d28d9]",
  "[--wa-violet-soft:#f1e9ff]",
  "[--wa-highlight:#fde68a]",
  "[--wa-quote-in:#00a884]",
  "[--wa-quote-out:#6bcbef]",
];

const DARK = [
  "dark:[--wa-green:#00a884]",
  "dark:[--wa-green-strong:#06cf9c]",
  "dark:[--wa-accent:#00a884]",
  "dark:[--wa-green-soft:#103529]",
  "dark:[--wa-green-ink:#7ae3c3]",
  "dark:[--wa-surface:#111b21]",
  "dark:[--wa-panel:#202c33]",
  "dark:[--wa-chat-bg:#0b141a]",
  "dark:[--wa-bubble-in:#202c33]",
  "dark:[--wa-bubble-out:#005c4b]",
  "dark:[--wa-input:#2a3942]",
  "dark:[--wa-hover:#202c33]",
  "dark:[--wa-active:#2a3942]",
  "dark:[--wa-avatar:#374248]",
  "dark:[--wa-text:#e9edef]",
  "dark:[--wa-heading:#e9edef]",
  "dark:[--wa-meta:#8696a0]",
  "dark:[--wa-icon:#aebac1]",
  "dark:[--wa-link:#53bdeb]",
  "dark:[--wa-border:#313d45]",
  "dark:[--wa-divider:#222d34]",
  "dark:[--wa-tick:#8696a0]",
  "dark:[--wa-read:#53bdeb]",
  "dark:[--wa-unread:#00a884]",
  "dark:[--wa-star:#f5b400]",
  "dark:[--wa-danger:#f15c6d]",
  "dark:[--wa-danger-ink:#f58b97]",
  "dark:[--wa-danger-border:#7a2a33]",
  "dark:[--wa-danger-soft:#3a1d22]",
  "dark:[--wa-blue:#8ab4ff]",
  "dark:[--wa-blue-soft:#1c2f4d]",
  "dark:[--wa-violet:#c4a7ff]",
  "dark:[--wa-violet-soft:#2d2146]",
  "dark:[--wa-highlight:#8a6d00]",
  "dark:[--wa-quote-in:#06cf9c]",
  "dark:[--wa-quote-out:#53bdeb]",
];

/** Va en la raíz del chat: declara las variables de los dos temas. */
export const WA_THEME = [...LIGHT, ...DARK].join(" ");

/** Clases repetidas del chat, ya con los tokens. */
export const wa = {
  /** Botón verde lleno. */
  primary: "bg-(--wa-green) text-white hover:bg-(--wa-green-strong)",
  /** Botón blanco con borde. */
  outline: "border border-(--wa-border) bg-(--wa-surface) text-(--wa-text) hover:bg-(--wa-hover)",
  /** Botón de borrar. */
  danger: "border border-(--wa-danger-border) bg-(--wa-surface) text-(--wa-danger-ink) hover:bg-(--wa-danger-soft)",
  /** Botón redondo de icono (cabecera, adjuntar…): 40 px, cómodo con el dedo. */
  iconButton: "grid size-10 shrink-0 place-items-center rounded-full text-(--wa-icon) hover:bg-(--wa-text)/5",
  bubbleIn: "bg-(--wa-bubble-in)",
  bubbleOut: "bg-(--wa-bubble-out)",
  /** La píldora gris de los avisos y separadores de fecha. */
  pill: "rounded-lg bg-(--wa-surface)/95 text-(--wa-icon) shadow-sm",
  bubbleShadow: "shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
} as const;
