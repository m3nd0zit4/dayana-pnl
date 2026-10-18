import { personFullName } from "./person-name";
import { foldForSearch } from "./crm/search-normalize";

/**
 * ¿Sabemos de verdad cómo se llama? Pedido de la dueña (18-oct-2026): «si no
 * está 100 % segura del nombre no lo menciona; si no lo sabe, lo pregunta».
 * Fely Mateo (+51…) recibió «Hola Fely» (su perfil de WhatsApp) y minutos
 * después «Felicitas» (el nombre que escribió al inscribirse al webinar): dos
 * nombres para la misma persona.
 *
 * El perfil de WhatsApp solo NO basta: puede ser un apodo, un negocio o el
 * teléfono de otra persona. Un nombre es seguro cuando:
 * - `said`: ella lo dijo en el chat («me llamo Ana», «soy Rosa», o contestó
 *   «Felicitas» a «¿Con quién tengo el gusto?»);
 * - `dayana`: Dayana la llama así en sus propios mensajes («Hola Rosa»);
 * - `form`: lo escribió ella (o Dayana) en un formulario: la inscripción a un
 *   evento, el cuestionario, un pago. No cuenta el contacto que el CRM creó
 *   copiando el perfil de WhatsApp.
 * Si dos fuentes seguras no coinciden, manda lo que ella dijo, luego cómo la
 * llama Dayana, luego el formulario.
 *
 * Puro: quien llama trae el perfil, el contacto y los mensajes.
 */

export type NameMessage = { from: "person" | "dayana" | "assistant"; text: string };

export type NameEvidence = "said" | "dayana" | "form";

export type NameResolution =
  /** Seguro: se usa `first` para saludar. `avoid`: otros nombres vistos (el perfil) que no se usan. */
  | { kind: "sure"; full: string; first: string; how: NameEvidence; avoid: string[] }
  /** Hay nombres (el perfil, un contacto copiado de él) pero nada los confirma: no se usa ninguno. */
  | { kind: "unsure"; candidates: string[] }
  /** Ni un nombre: el perfil es una frase («DIOS ES MI PROVEEDOR 🙏») o no hay. */
  | { kind: "unknown"; profile: string | null };

export type NameInput = {
  /** El nombre del perfil de WhatsApp (`participantName`). */
  profile: string | null | undefined;
  /** El contacto del CRM; `typed`: el nombre lo escribió una persona, no se copió del perfil. */
  contact?: { name: string | null | undefined; typed: boolean } | null;
  /** El chat en orden (el más viejo primero). */
  messages: NameMessage[];
};

/** Lo que la asistente o Dayana preguntan para saber el nombre (texto doblado). */
const ASKS_NAME = /con quien tengo el gusto|como te llamas|cual es tu (nombre|gracia)|me (dices|regalas|compartes) tu nombre|tu nombre\s*\?/;

/** Palabras de una respuesta que no es un nombre («Hola», «Estoy bien», «Sí, gracias»). */
const NOT_AN_ANSWER = new Set([
  "hola", "holi", "si", "ok", "okay", "bien", "mal", "regular", "gracias", "buenas", "buenos", "buen", "dia", "dias", "tardes",
  "noches", "claro", "perfecto", "listo", "vale", "amen", "bendiciones", "muy", "igualmente", "excelente", "genial", "dale",
  "estoy", "todo", "aqui", "aca", "tambien", "igual", "perdon", "disculpa", "quiero", "necesito", "tengo", "me", "te", "le",
  "nos", "que", "quien", "como", "cuando", "donde", "porque", "pues", "hoy", "ayer", "manana", "ya", "entonces", "info",
  "informacion", "precio", "dayana",
]);

/** Lo que sigue a «soy» sin ser un nombre: de dónde es, qué hace, quién es para alguien. */
const SOY_NOT_A_NAME = new Set([
  "nueva", "nuevo", "colombiana", "colombiano", "peruana", "peruano", "mexicana", "mexicano", "venezolana", "venezolano",
  "ecuatoriana", "ecuatoriano", "chilena", "chileno", "argentina", "argentino", "boliviana", "boliviano", "espanola", "espanol",
  "panamena", "panameno", "costarricense", "guatemalteca", "guatemalteco", "hondurena", "hondureno", "dominicana", "dominicano",
  "uruguaya", "uruguayo", "paraguaya", "paraguayo", "cubana", "cubano", "salvadorena", "salvadoreno", "nicaraguense",
  "estadounidense", "americana", "americano", "latina", "latino", "cristiana", "cristiano", "catolica", "catolico",
  "madre", "padre", "mama", "papa", "estudiante", "docente", "profesora", "profesor", "maestra", "maestro", "enfermera",
  "enfermero", "abogada", "abogado", "psicologa", "psicologo", "terapeuta", "coach", "doctora", "doctor", "ingeniera",
  "ingeniero", "clienta", "cliente", "amiga", "amigo", "hija", "hijo", "esposa", "esposo", "hermana", "hermano",
  "una", "un", "la", "el", "de", "del", "yo", "muy", "bastante", "alguien", "persona", "mujer", "hombre", "seguidora", "seguidor",
]);

/** Un nombre no termina en «y», «de», «la»… («me llamo Ana y quiero…» → «Ana»). */
const CONNECTORS = new Set(["y", "e", "de", "del", "la", "las", "los"]);

/** Saludos tras los que va el nombre de quien recibe el mensaje: sobre texto doblado… */
const ADDRESS_FOLDED = "hola|holi|gracias|con gusto|claro|perfecto|listo|bienvenid[ao]|buen[oa]s? (?:dias|tardes|noches)|te bendigo|bendiciones";
/** …y sobre la respuesta tal cual, con o sin tilde. */
const ADDRESS_RAW = "hola|holi|gracias|con gusto|claro|perfecto|listo|bienvenid[ao]|buen[oa]s? (?:d[ií]as|tardes|noches)|te bendigo|bendiciones";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿El texto (doblado) le habla a alguien con ese nombre («Hola Rosa», «…, Rosa 🙏»)? */
const addresses = (folded: string, name: string): boolean => {
  const n = escapeRe(name);
  return (
    new RegExp(`(?:^|[^a-z])(?:${ADDRESS_FOLDED})\\s*,?\\s*${n}(?![a-z])`).test(folded) ||
    new RegExp(`(?:^|\\n)\\s*${n}\\s*[,!:]`).test(folded) ||
    new RegExp(`,\\s*${n}\\s*(?:[.!?\\n]|$|[^\\sa-z])`).test(folded)
  );
};

/** El nombre de las palabras dichas, de la versión más larga a la más corta. */
const nameFromWords = (words: string[]): string | null => {
  for (let n = Math.min(words.length, 3); n >= 1; n--) {
    const candidate = words.slice(0, n);
    const folded = candidate.map((w) => foldForSearch(w));
    if (folded.some((w) => NOT_AN_ANSWER.has(w)) || CONNECTORS.has(folded[n - 1]!)) continue;
    const full = personFullName(candidate.join(" "));
    if (full) return full;
  }
  return null;
};

/** Las palabras que siguen, hasta el primer signo («Rosa, de Lima» → «Rosa»). */
const wordsAfter = (text: string, index: number): string[] =>
  text
    .slice(index)
    .split(/[\n.,;:!?¡¿()]/)[0]!
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** El nombre con el que se presenta en un mensaje, o null. */
export const selfIntroducedName = (text: string): string | null => {
  // «me llamo», «mi nombre es», «te habla»: lo que sigue es su nombre.
  const intro = /(?:^|[^\p{L}])(?:me llamo|mi nombre es|te habla|le habla|les habla)\s+/iu.exec(text);
  if (intro) {
    const name = nameFromWords(wordsAfter(text, intro.index + intro[0].length));
    if (name) return name;
  }
  // «soy Rosa»: solo con mayúscula y si no dice de dónde es o qué hace («soy colombiana»).
  for (const m of text.matchAll(/(?:^|[^\p{L}])(?:[Ss]oy|SOY)\s+(?=\p{Lu})/gu)) {
    const words = wordsAfter(text, m.index + m[0].length);
    if (!words.length || SOY_NOT_A_NAME.has(foldForSearch(words[0]!))) continue;
    const capitalized: string[] = [];
    for (const w of words) {
      if (!/^\p{Lu}/u.test(w)) break;
      capitalized.push(w);
    }
    const name = nameFromWords(capitalized);
    if (name) return name;
  }
  return null;
};

/** Contestó solo su nombre a «¿Con quién tengo el gusto?» («Felicitas», «Soy Ana»). */
const answeredName = (text: string): string | null => {
  const words = text
    .replace(/[^\p{L}\s'’-]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const rest = words.length && foldForSearch(words[0]!) === "soy" ? words.slice(1) : words;
  if (rest.length === 0 || rest.length > 3 || SOY_NOT_A_NAME.has(foldForSearch(rest[0]!))) return null;
  return nameFromWords(rest);
};

/** Lo último que dijo de su nombre en el chat. */
const saidName = (messages: NameMessage[]): string | null => {
  let found: string | null = null;
  let asked = false;
  for (const m of messages) {
    if (m.from !== "person") {
      asked = ASKS_NAME.test(foldForSearch(m.text));
      continue;
    }
    const name = selfIntroducedName(m.text) ?? (asked ? answeredName(m.text) : null);
    if (name) found = name;
    asked = false;
  }
  return found;
};

const firstOf = (full: string) => full.split(" ")[0]!;
const same = (a: string, b: string) => foldForSearch(a) === foldForSearch(b);

export const resolvePersonName = (input: NameInput): NameResolution => {
  const profile = personFullName(input.profile);
  const contact = personFullName(input.contact?.name);
  const seen = [...new Set([contact, profile].filter((n): n is string => Boolean(n)))];
  /** Los otros nombres vistos (completos y de pila) que no son el seguro. */
  const avoid = (first: string) => [...new Set(seen.flatMap((full) => [full, firstOf(full)]).filter((n) => !same(firstOf(n), first)))];
  const sure = (full: string, how: NameEvidence): NameResolution => ({ kind: "sure", full, first: firstOf(full), how, avoid: avoid(firstOf(full)) });

  const said = saidName(input.messages);
  if (said) return sure(said, "said");

  const dayanaText = input.messages.filter((m) => m.from === "dayana").map((m) => foldForSearch(m.text));
  const byDayana = seen.find((full) => dayanaText.some((t) => addresses(t, foldForSearch(firstOf(full)))));
  if (byDayana) return sure(byDayana, "dayana");

  if (contact && input.contact?.typed) return sure(contact, "form");

  if (seen.length) return { kind: "unsure", candidates: seen };
  return { kind: "unknown", profile: input.profile?.trim() || null };
};

/** El nombre para saludar en un mensaje automático (recordatorio, aviso), o null si no es seguro. */
export const sureFirstName = (r: NameResolution): string | null => (r.kind === "sure" ? r.first : null);

/** Los nombres que no se pueden usar en la respuesta, el más largo primero («Fely Mateo» antes que «Fely»). */
const forbiddenNames = (r: NameResolution): string[] => {
  const names = r.kind === "sure" ? r.avoid : r.kind === "unsure" ? r.candidates.flatMap((full) => [full, firstOf(full)]) : [];
  return [...new Set(names)].sort((a, b) => b.length - a.length);
};

const VOWELS: Record<string, string> = { a: "[aáàä]", e: "[eéèë]", i: "[iíìï]", o: "[oóòö]", u: "[uúùü]", n: "[nñ]" };

/** El nombre con o sin tildes («Jesus» y «Jesús» por igual), palabras separadas por espacios. */
const looseName = (name: string) =>
  foldForSearch(name)
    .split(/\s+/)
    .map((word) => [...word].map((ch) => VOWELS[ch] ?? escapeRe(ch)).join(""))
    .join("\\s+");

const upperFirst = (s: string) => s.charAt(0).toLocaleUpperCase("es") + s.slice(1);

/**
 * La respuesta sin los nombres que no son seguros, y con el seguro donde la IA
 * usó otro: «Hola Fely, te bendigo» → «Hola, te bendigo»; «Con gusto, Fely 🙏»
 * → «Con gusto 🙏» (o «Con gusto, Felicitas 🙏» si el seguro es Felicitas).
 * Solo donde el nombre es a quién se le habla: «que la paz de Dios…» queda igual.
 */
export const fixNameInReply = (text: string, r: NameResolution): string => {
  const replacement = r.kind === "sure" ? r.first : null;
  let out = text;
  for (const name of forbiddenNames(r)) {
    const n = looseName(name);
    const greeting = new RegExp(`(^|[^\\p{L}])(${ADDRESS_RAW})(\\s*,?\\s*)${n}(?![\\p{L}])`, "giu");
    const afterComma = new RegExp(`,\\s*${n}(?=\\s*(?:[.!?…\\n]|$|[^\\s\\p{L}\\d]))`, "giu");
    // La letra que sigue va en mayúscula, salvo un enlace («Pricila, https://…» → «https://…»).
    const leading = new RegExp(`(^|\\n)(\\s*)${n}\\s*,\\s*(?:(?!https?:|www\\.)(\\p{L}))?`, "giu");
    if (replacement) {
      out = out
        .replace(greeting, (_m, pre: string, word: string, gap: string) => `${pre}${word}${gap || " "}${replacement}`)
        .replace(afterComma, `, ${replacement}`)
        .replace(leading, (_m, pre: string, gap: string, next?: string) => `${pre}${gap}${replacement}, ${next ?? ""}`);
    } else {
      out = out
        .replace(greeting, (_m, pre: string, word: string) => `${pre}${word}`)
        .replace(afterComma, "")
        .replace(leading, (_m, pre: string, gap: string, next?: string) => `${pre}${gap}${next ? upperFirst(next) : ""}`);
    }
  }
  return out === text ? text : out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.!?])/g, "$1");
};
