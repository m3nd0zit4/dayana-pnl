// Puro (sin base de datos): lo usa también la pantalla de ajustes en el navegador.

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Solo lo que cambió entre dos versiones (listas enteras). Guardar ya no manda
 * la configuración completa leída al abrir la página: eso borraba lo que otra
 * pantalla o el asistente cambiaron mientras tanto.
 */
export const diffConfig = (before: unknown, after: unknown): Record<string, unknown> | undefined => {
  if (isPlainObject(before) && isPlainObject(after)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(after)) {
      const d = diffConfig(before[key], after[key]);
      if (d !== undefined) out[key] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(before) === JSON.stringify(after) ? undefined : (after as Record<string, unknown>);
};

