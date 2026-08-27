/**
 * Portadas de los cursos.
 *
 * Ninguno tiene imagen todavía (`Product.imageUrl` está vacío para los ocho) y
 * una rejilla de tarjetas de sólo texto se lee como una lista de archivos, no
 * como un catálogo. En vez de esperar a que existan ocho fotografías —o de
 * poner ocho veces la misma— cada curso tiene su propia portada compuesta:
 * un degradado de la paleta de marca, un número romano y una palabra clave.
 *
 * Es deliberado que se parezcan entre sí: son ocho piezas de una biblioteca,
 * no ocho productos distintos. `Product.imageUrl` sigue mandando cuando Dayana
 * suba una foto desde el CRM, así que esto es el suelo, no el techo.
 */

export type CourseCover = {
  /** Degradado de fondo, en CSS. */
  gradient: string;
  /** Marca de agua tipográfica: el número del curso en la biblioteca. */
  numeral: string;
  /** Una palabra que resume el curso. Va grande, detrás del título. */
  keyword: string;
  /** Color del texto sobre el degradado. */
  ink: "light" | "dark";
};

/**
 * Definidas por slug y no generadas por hash: el degradado y la palabra tienen
 * que decir algo del curso. Un color aleatorio estable sigue siendo aleatorio.
 */
const COVERS: Record<string, CourseCover> = {
  "fundamentos-pnl": {
    gradient: "linear-gradient(145deg, #2b2118 0%, #6b4a33 55%, #c0654a 100%)",
    numeral: "I",
    keyword: "Base",
    ink: "light",
  },
  "niveles-de-conciencia": {
    gradient: "linear-gradient(145deg, #1c2333 0%, #3f4a68 55%, #8792b5 100%)",
    numeral: "II",
    keyword: "Espiral",
    ink: "light",
  },
  "hipnosis-y-pnl": {
    gradient: "linear-gradient(145deg, #17161f 0%, #382f4d 55%, #6d5b8f 100%)",
    numeral: "III",
    keyword: "Trance",
    ink: "light",
  },
  "creencias-limitantes": {
    gradient: "linear-gradient(145deg, #3a1f1a 0%, #8a3b2c 55%, #edc3b1 100%)",
    numeral: "IV",
    keyword: "Raíz",
    ink: "light",
  },
  "poder-del-lenguaje": {
    gradient: "linear-gradient(145deg, #24291d 0%, #4f5b39 55%, #a8b678 100%)",
    numeral: "V",
    keyword: "Palabra",
    ink: "light",
  },
  "emociones-y-anclajes": {
    gradient: "linear-gradient(145deg, #2d1d24 0%, #6d3a4c 55%, #c98098 100%)",
    numeral: "VI",
    keyword: "Ancla",
    ink: "light",
  },
  "pnl-en-pareja": {
    gradient: "linear-gradient(145deg, #331f1c 0%, #7a4437 55%, #d4b896 100%)",
    numeral: "VII",
    keyword: "Vínculo",
    ink: "light",
  },
  "pnl-liderazgo": {
    gradient: "linear-gradient(145deg, #1e2422 0%, #3d5450 55%, #86a39c 100%)",
    numeral: "VIII",
    keyword: "Mando",
    ink: "light",
  },
};

/** Portada de reserva para un curso que se añada sin entrada aquí. */
const FALLBACK: CourseCover = {
  gradient: "linear-gradient(145deg, #221c17 0%, #55483c 55%, #d4b896 100%)",
  numeral: "•",
  keyword: "PNL",
  ink: "light",
};

export const getCourseCover = (slug: string): CourseCover =>
  COVERS[slug] ?? FALLBACK;
