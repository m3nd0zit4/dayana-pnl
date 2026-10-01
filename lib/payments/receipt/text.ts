/**
 * Texto apto para imprimir en el recibo.
 *
 * El PDF no tiene motor de composición tipográfica ni fuente de emoji: lo que
 * la fuente no trae sale como un hueco o un cuadro, y un acento suelto
 * (`a` + U+0301, que es como llegan algunos nombres pegados desde un iPhone)
 * se dibuja desplazado o no se dibuja. Por eso:
 *
 * - se normaliza a NFC, que vuelve a juntar `a` + tilde en `á`;
 * - se quitan emoji, ZWJ, selectores de variación, tonos de piel, banderas,
 *   caracteres de formato invisibles y U+FFFD;
 * - se quitan las marcas combinantes que NFC no pudo componer;
 * - se colapsan espacios y saltos de línea.
 *
 * Pura y sin dependencias: sirve igual para el nombre de quien paga que para
 * el concepto o el medio de pago.
 */

// Emoji y sus piezas. Los tonos de piel y los indicadores regionales (las
// banderas) no cuentan como Extended_Pictographic, así que van aparte.
const PICTOGRAPHIC =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/gu;

// Formato invisible (ZWJ, ZWSP, marcas de dirección, BOM, guion virtual,
// etiquetas), selectores de variación de texto/emoji y el carácter de
// reemplazo, que sólo aparece cuando algo ya llegó roto.
const INVISIBLE = /[\p{Cf}\u{FE0E}\u{FE0F}\u{FFFD}]/gu;

// Marcas combinantes que siguen sueltas después de NFC.
const STRAY_MARKS = /\p{M}/gu;

const SPACES = /[\s\p{Cc}]+/gu;

export const pdfText = (s: string): string =>
  s
    .replace(PICTOGRAPHIC, "")
    .replace(INVISIBLE, "")
    .normalize("NFC")
    .replace(STRAY_MARKS, "")
    .replace(SPACES, " ")
    .trim();

/** Igual, para campos opcionales: vacío después de limpiar cuenta como ausente. */
export const pdfTextOrNull = (s: string | null | undefined): string | null =>
  s ? pdfText(s) || null : null;
