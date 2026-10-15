/**
 * El orden del curso tal como lo ve la alumna en el reproductor.
 *
 * Cada módulo abre con su «Introducción» (el `bodyMd` del módulo, cuando lo
 * tiene) y sigue con sus lecciones por `sortOrder`. El índice lateral y los
 * botones anterior/siguiente del reproductor ya recorrían el curso así, pero el
 * servidor decidía dónde entrar mirando solo las lecciones: «Empezar» caía en
 * la segunda fila del temario, saltándose la Introducción que tenía encima.
 *
 * Puro y sin Prisma: lo usan tanto el servidor como componentes de cliente.
 */

/** Id centinela de la lectura propia de un módulo, distinto de un id de lección. */
export const readingId = (moduleId: string) => `reading:${moduleId}`;

export type SequenceModule = {
  id: string;
  bodyMd: string | null;
  /** Ya ordenadas como las muestra el reproductor (`sortOrder`, luego `createdAt`). */
  classes: ReadonlyArray<{ id: string }>;
};

/** Un módulo sin texto no tiene fila de «Introducción» en el temario. */
export const hasModuleReading = (mod: Pick<SequenceModule, "bodyMd">): boolean =>
  Boolean(mod.bodyMd?.trim());

/** Las entradas de un módulo, en el orden del temario. */
export const moduleItemIds = (mod: SequenceModule): string[] => [
  ...(hasModuleReading(mod) ? [readingId(mod.id)] : []),
  ...mod.classes.map((cls) => cls.id),
];

/** La primera entrada de un módulo: su Introducción o, si no tiene, su primera lección. */
export const moduleStartId = (mod: SequenceModule): string | null =>
  moduleItemIds(mod)[0] ?? null;

/** La primera entrada del curso entero — por donde se empieza. */
export const courseStartId = (
  modules: ReadonlyArray<SequenceModule>
): string | null => {
  for (const mod of modules) {
    const start = moduleStartId(mod);
    if (start) return start;
  }
  return null;
};

/**
 * Dónde abre el reproductor cuando la URL no pide una entrada concreta.
 *
 * Sin ninguna lección completada, por el principio del curso: es lo que
 * promete «Empezar». Con progreso, en la siguiente lección sin completar
 * («Continuar»). Con todo completado, otra vez por el principio («Repasar»).
 */
export const courseEntryId = (
  modules: ReadonlyArray<SequenceModule>,
  progress: { completedClasses: number; nextIncompleteClassId: string | null }
): string | null =>
  (progress.completedClasses > 0 ? progress.nextIncompleteClassId : null) ??
  courseStartId(modules);
