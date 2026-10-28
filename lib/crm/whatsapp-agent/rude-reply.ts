import { foldForSearch } from "../search-normalize";

/**
 * Quien insulta después de su llamada gratis (Alejandra, 27-oct: al 2º
 * seguimiento del cierre contestó «Lo único q les interesa es la plata… ni
 * siquiera dejó explicar lo que sentía y solo pide es plata / Coman mierda» +
 * «Interesadas», y la IA le dijo «Entiendo tu frustración, Alejandra. Quedamos
 * en contacto»). Dueña: «cuando la persona empieza a insultar o a tratar mal,
 * con un lenguaje agresivo… hay que hacerle entender que Dayana solo tenía 15
 * minutos de una llamada gratuita, que si no se sintió escuchada o atendida
 * para eso son las sesiones personalizadas… las llamadas siempre duran 15
 * minutos o más y la agenda está llena… y que la línea de atención de su país
 * tiene personas gratuitas que la pueden ayudar si necesita ser escuchada…
 * que el modelo solo le envíe esto en estos casos».
 *
 * Puro: detecta el insulto y da el texto (lo pone el código, no el modelo).
 */

/**
 * Letras «de adorno» a letras normales, solo para leer lo que escribió: las
 * versalitas (ʟᴏ ᴜɴɪᴄᴏ ǫ ʟᴇs ɪɴᴛᴇʀᴇsᴀ, Alejandra) no tienen forma
 * compatible en Unicode; las matemáticas (𝐴𝑙𝑒) sí (NFKC). La «ǫ» la usan por «q».
 */
const SMALL_CAPS: Record<string, string> = {
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m",
  ɴ: "n", ᴏ: "o", ᴘ: "p", ǫ: "q", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z",
};
export const plainLetters = (text: string): string =>
  [...text.normalize("NFKC")].map((ch) => SMALL_CAPS[ch] ?? ch).join("").normalize("NFC");

/**
 * Groserías y acusaciones dirigidas a Dayana o a nosotras. No lo que dice de
 * sí o de su vida («me siento una mierda», «mi vida es una basura», «soy una
 * estúpida»: eso es lo que Dayana trabaja), ni «me estafaron antes».
 */
const INSULT = new RegExp(
  [
    "\\b(coman|comete|comase|coma) mierda\\b",
    "\\b(vayan(se)?|vete|vallan(se)?|valla(se)?) (a la |al )?(mierda|porra|verga|carajo|diablo)\\b",
    "\\b(que se jodan|jodanse|jodete)\\b",
    "\\b(hijue?putas?|hijos? de (puta|perra)|hdp|malparid[ao]s?|gonorreas?|careverga)\\b",
    "\\bque mierda de (llamada|servicio|atencion|terapia|asistente|ayuda|persona)\\b",
    "\\b(esto es|es una|son|eres|es usted|ustedes son) (unas? |unos? )?(estafa|estafador\\w*|ladron\\w*|charlatan\\w*|farsantes?|sinverguenzas?|rateras?|mentiros[ao]s|aprovechad[ao]s|interesad[ao]s)\\b",
    "\\b(son|eres|es usted|ustedes son) (unas? |unos? )?(basura|porqueria|idiotas?|estupid[ao]s?|imbeciles?)\\b",
    "\\bestafador[ae]s\\b",
    // «Lo único q les interesa es la plata», «solo piden plata».
    "\\b(solo|lo unico (que|q)) (les|le|te|a ustedes|a ella) (interesa|importa) (es )?(la |el )?(plata|dinero|cobrar|billete|pago)\\b",
    "\\bsolo (piden|pide|quieren|quiere|buscan|busca|cobran|cobra) (es )?(la |el )?(plata|dinero)\\b",
  ].join("|")
);
/** Una sola palabra como insulto: «Interesadas», «Estafadoras». */
const ALONE = /^(interesad[ao]s|estafador[ae]s|ladron[ae]s|mentiros[ao]s|aprovechad[ao]s|charlatan[ae]s)$/;

const read = (text: string) =>
  foldForSearch(plainLetters(text))
    .replace(/[¡!¿?.,;:…"'«»()*_~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Lo que acaba de escribir trae un insulto o una acusación dirigida. */
export const insults = (texts: (string | null | undefined)[]): boolean =>
  texts.some((raw) => {
    const t = read(raw ?? "");
    return Boolean(t) && (INSULT.test(t) || ALONE.test(t));
  });

/** La respuesta (solo esta, dueña): los 15 minutos, las sesiones y las líneas gratuitas de su país. */
export const RUDE_REPLY =
  "Lamento que te hayas sentido así. La llamada gratis con Dayana es de 15 minutos: es un primer espacio para conocer tu caso y orientarte, y aunque su agenda está llena, ella le dedica ese tiempo (y muchas veces más) a cada persona. Escucharte a fondo y trabajar lo que estás viviendo es lo que se hace en las sesiones personalizadas. Si lo que necesitas ahora es que alguien te escuche, en tu país hay líneas de atención gratuitas con personas que te pueden acompañar.";

const RUDE_MARK = "la llamada gratis con dayana es de 15 minutos";

/** Ya se le mandó (30 días): si sigue insultando, no se le contesta más. */
export const rudeReplied = (
  lines: { direction: "INBOUND" | "OUTBOUND"; body: string | null; sentAt?: Date | null }[],
  now: number
): boolean =>
  lines.some(
    (l) =>
      l.direction === "OUTBOUND" &&
      foldForSearch(l.body ?? "").includes(RUDE_MARK) &&
      (!l.sentAt || now - l.sentAt.getTime() < 30 * 24 * 3600_000)
  );
