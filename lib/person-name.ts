import { foldForSearch } from "./crm/search-normalize";

/**
 * ¿El nombre de un perfil de WhatsApp (o de un contacto creado con él) es el
 * nombre de una persona? Mucha gente pone una frase, un negocio o unas
 * iniciales: «DIOS ES MI PROVEEDOR 🙏», «en la universidad 🥰🥰🥰», «SF». La
 * asistente saludó «Hola DIOS ES MI PROVEEDOR» y contestó «Sí, Dios es mi
 * proveedor» (14-oct-2026). Con esto, lo que no parece un nombre no se usa: se
 * saluda sin nombre y se le pregunta.
 *
 * Puro. Devuelve el primer nombre listo para saludar («ENNY jose» → «Enny»)
 * o null.
 */

/** Palabras que no son de un nombre: fe, frases, negocios, lugares. */
const NOT_A_NAME = new Set(
  [
    "dios", "senor", "cristo", "jehova", "amen", "bendecido", "bendecida", "bendecidos", "bendicion", "bendiciones",
    // Gloria, Esperanza, Paz, Milagros o María Fe sí son nombres: no van aquí.
    "proveedor", "aleluya",
    "familia", "mama", "mami", "papa", "papi", "bebe", "hijo", "hija", "abuela", "abuelo", "tia", "tio",
    "tienda", "store", "shop", "oficial", "official", "ventas", "venta", "servicio", "servicios", "negocio",
    "empresa", "boutique", "spa", "salon", "estudio", "studio", "beauty", "nails", "unas", "moda",
    "inversiones", "sas", "ltda", "universidad", "colegio", "iglesia", "ministerio", "consultorio",
    "whatsapp", "business", "usuario", "user", "unknown", "desconocido", "cliente", "clienta",
  ]
);

/** Palabras de frase (verbos, pronombres, preposiciones): un nombre no las lleva. */
const SENTENCE_WORDS = new Set(
  ["es", "mi", "mis", "tu", "tus", "su", "sus", "soy", "yo", "eres", "en", "con", "sin", "por", "para", "que", "the", "my", "of", "and", "is", "no"]
);

/** Tratamientos que van antes del nombre: se saltan. */
const TITLES = new Set(["dra", "dr", "doctora", "doctor", "sra", "sr", "srta", "lic", "ing", "prof", "don", "dona"]);

const capitalize = (word: string) => word.charAt(0).toLocaleUpperCase("es") + word.slice(1).toLocaleLowerCase("es");

/** «ENNY» o «samy» → «Enny», «Samy»; «McKenzie» se respeta. */
const tidy = (word: string) => {
  const mixed = word !== word.toLocaleUpperCase("es") && word !== word.toLocaleLowerCase("es");
  return mixed ? word : capitalize(word);
};

/** Las palabras del nombre desde la primera que no es un tratamiento («Dra.»), o null si no es un nombre. */
const nameWords = (raw: string | null | undefined): string[] | null => {
  const text = (raw ?? "").trim();
  // Un correo, un enlace o un teléfono al principio («+57 300…»): no es un nombre.
  if (!text || /@|https?:|www\./i.test(text) || /^[+\d(]/.test(text)) return null;
  // Emojis, números («Laurita +573001234567»), símbolos y puntuación fuera; se
  // quedan letras, espacios, apóstrofo y guion.
  const words = text
    .replace(/[^\p{L}\s'’-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, ""))
    .filter(Boolean);
  if (words.length === 0 || words.length > 7) return null;
  const folded = words.map((w) => foldForSearch(w));
  if (folded.some((w) => NOT_A_NAME.has(w) || SENTENCE_WORDS.has(w))) return null;
  const at = folded.findIndex((w) => !TITLES.has(w));
  const first = at >= 0 ? words[at] : undefined;
  // Iniciales («SF», «J»): sin vocal o de una letra, no es un nombre.
  if (!first || first.length < 2 || !/[aeiouáéíóúü]/i.test(first)) return null;
  return words.slice(at);
};

export const personFirstName = (raw: string | null | undefined): string | null => {
  const words = nameWords(raw);
  return words ? tidy(words[0]!) : null;
};

const KEEP_LOWER = new Set(["de", "del", "la", "las", "los", "y"]);

/**
 * El nombre completo, sin emojis, sin tratamiento y con mayúsculas normales
 * («ENNY jose 🙏» → «Enny Jose», «Dra. Ana López» → «Ana López»), o null si no
 * es el nombre de una persona. Para nombres compuestos: «Juan pablo» se
 * saluda «Juan Pablo».
 */
export const personFullName = (raw: string | null | undefined): string | null => {
  const words = nameWords(raw);
  if (!words) return null;
  return words.map((w, i) => (i > 0 && KEEP_LOWER.has(w.toLocaleLowerCase("es")) ? w.toLocaleLowerCase("es") : tidy(w))).join(" ");
};
