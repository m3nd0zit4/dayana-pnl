/**
 * «bytes=0-1», «bytes=100-», «bytes=-500» → [inicio, fin] dentro del archivo,
 * o `null` si el rango no se puede servir. Safari en iPhone pide audio y
 * video así, y sin respuesta por partes no los reproduce.
 */
export const parseRange = (header: string | null, size: number): [number, number] | null => {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : null;
};
