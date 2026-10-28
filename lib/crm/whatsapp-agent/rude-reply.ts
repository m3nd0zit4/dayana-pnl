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
 * Solo lo dirigido a Dayana o a nosotras, frase por frase. No lo que cuenta de
 * otros («mi esposo es un hijueputa», «a mi mamá solo le interesa el dinero»,
 * «mis hermanos son unos interesados»), ni lo que dice de sí («me siento una
 * mierda», «qué mierda de persona soy»: eso es lo que Dayana trabaja), ni una
 * duda («¿esto es una estafa?»), ni «me estafaron otros estafadores»
 * (revisión 28-oct).
 */
/** Órdenes a quien lee: siempre van a nosotras. */
const SEND_OFF = /\b(coman|comete|comase|coma) mierda\b|\b(vayan(se)?|vete|vallan(se)?) (a la |al )?(mierda|porra|verga|carajo|diablo)\b|\b(que se jodan|jodanse|jodete)\b/;
const NAMES =
  "estafa|estafador\\w*|ladron\\w*|charlatan\\w*|farsantes?|sinverguenzas?|rateras?|mentiros\\w*|aprovechad\\w*|interesad\\w*|basura|porqueria|idiotas?|estupid\\w*|imbeciles?|hijue?putas?|malparid\\w*|gonorreas?|perras?";
/** «Son unas estafadoras», «ustedes son unas interesadas», «eres una hp», «esto es una estafa». */
const CALLS_US = new RegExp(
  `\\b(ustedes son|usted es|son|eres|dayana es|la doctora es|la asistente es|esto es)\\s+(unas?\\s+|unos?\\s+|puras?\\s+)?(${NAMES})\\b`
);
/** «Lo único q les interesa es la plata», «solo piden plata». */
const ONLY_MONEY =
  /\b(solo|lo unico (que|q)) (les|le|te) (interesa|importa) (es )?(la |el )?(plata|dinero|cobrar|billete|pago)\b|\bsolo (piden|pide|quieren|quiere|buscan|busca|cobran|cobra) (es )?(la |el )?(plata|dinero)\b/;
const OUR_SERVICE = /\bque mierda de (llamada|servicio|atencion|terapia|asistente|ayuda)\b/;
/** Una sola palabra como insulto: «Interesadas», «Estafadoras», «Malparidas». */
const ALONE = new RegExp(`^(${NAMES})$`);
/** Habla de otra persona en esa frase. */
const SOMEONE_ELSE =
  /\b(mis?)\s+\w+|\b(esposo|esposa|marido|ex|expareja|pareja|novio|novia|mama|madre|papa|padre|hermanos?|hermanas?|hijos?|hijas?|familia|familiares|jefe|jefa|suegr[ao]s?|cunad[ao]s?|companer[ao]s?|amig[ao]s?|vecin[ao]s?|todos|todas|ellos|ellas|gente|demas|otros|otras)\b/;
/** Habla de sí. */
const ABOUT_HERSELF = /\b(soy|me siento|me senti|estoy|estaba)\b/;

const read = (text: string) =>
  foldForSearch(text)
    .replace(/[¡!¿?.,;:…"'«»()*_~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Lo que acaba de escribir trae un insulto o una acusación dirigida a Dayana o a nosotras. */
export const insults = (texts: (string | null | undefined)[]): boolean =>
  texts.some((raw) =>
    (plainLetters(raw ?? "").match(/[^.!?\n…]+[.!?…]*/g) ?? []).some((piece) => {
      const t = read(piece);
      if (!t || /[?¿]/.test(piece)) return false;
      if (SEND_OFF.test(t)) return true;
      if (SOMEONE_ELSE.test(t) || ABOUT_HERSELF.test(t)) return false;
      return ALONE.test(t) || CALLS_US.test(t) || ONLY_MONEY.test(t) || OUR_SERVICE.test(t);
    })
  );

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
