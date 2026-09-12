import { minorToMajor } from "./money";

/**
 * CSV mínimo para exports del CRM.
 *
 * Dos riesgos por celda, no uno: separadores/comillas/saltos de línea
 * (RFC 4180 — se resuelve envolviendo en comillas y doblando las internas), y
 * una celda que EMPIEZA por `= + - @` —o por tabulador o retorno de carro, que
 * algunas hojas ignoran antes de leer esos mismos signos—, que Excel/Sheets
 * interpreta como el
 * inicio de una fórmula al abrir el archivo. Un nombre o un código de error
 * que por casualidad empiece así ejecutaría lo que sea que venga después. Se
 * neutraliza anteponiendo un apóstrofo: Excel lo muestra como texto plano.
 */
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

export const csvField = (value: unknown): string => {
  let s = value === null || value === undefined ? "" : String(value);
  if (FORMULA_PREFIX_RE.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
};

export const csvRow = (values: unknown[]): string =>
  `${values.map(csvField).join(",")}\r\n`;

/**
 * Importe para una celda de hoja de cálculo: unidades mayores, punto decimal,
 * sin separador de miles.
 *
 * NO se usa `formatMoneyMinor` aquí. Formatea los pesos con `es-CO`, que
 * agrupa con punto: 157480 sale como «157.480», y un Excel con locale inglés
 * lo lee como 157,48. En un export que alguien va a sumar para la
 * contabilidad, eso es un error de dos órdenes de magnitud disfrazado de
 * número correcto. El símbolo y el formato bonito son cosa de la pantalla; el
 * CSV lleva la cifra cruda y la moneda en su propia columna.
 */
export const csvMoney = (
  amountMinor: number | null | undefined,
  currency: string
): string =>
  amountMinor == null ? "" : minorToMajor(amountMinor, currency).toString();
