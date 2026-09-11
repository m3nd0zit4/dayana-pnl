/**
 * Serialización CSV para las descargas del panel.
 *
 * Existe porque cada exportación lo resolvía a su manera y ninguna escapaba
 * igual. Un nombre con coma —«Ruiz, Andrés»— partía la fila en dos columnas y
 * desplazaba todo lo que venía detrás, así que la hoja se leía bien hasta que
 * llegaba el primer cliente con apellido compuesto.
 */

/**
 * Una celda.
 *
 * Se entrecomilla SIEMPRE en lugar de sólo cuando hace falta. Decidir por celda
 * obliga a acertar con la lista de caracteres peligrosos —coma, comilla, salto
 * de línea, retorno de carro— y basta olvidar uno para corromper la fila. Las
 * comillas internas se duplican, que es como las escapa el propio formato.
 */
const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '""';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
};

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

/**
 * Filas a texto CSV.
 *
 * Lleva BOM porque el destino es Excel: sin él, Excel lee el archivo en la
 * codificación del sistema y cualquier tilde aparece rota. Y separa con CRLF,
 * que es lo que pide el formato y lo que Excel espera.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Cabeceras para servir el CSV como descarga con nombre. */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}
