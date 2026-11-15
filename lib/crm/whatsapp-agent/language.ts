import { foldForSearch } from "../search-normalize";

/**
 * El idioma en que escribe la persona, si no es español (dueña, 14-nov: «si la
 * persona contesta en otro idioma, el agente debe entenderlo, contestarle en ese
 * idioma y comentarle que Dayana trabaja en español»). Puro y barato: cuenta
 * palabras muy frecuentes de cada idioma en lo último que escribió. `null` =
 * español o no se sabe (un «ok», un emoji, un nombre).
 */
export type OtherLanguage = "en" | "pt" | "fr" | "it" | "de";

const WORDS: Record<OtherLanguage | "es", string[]> = {
  es: ["el", "la", "los", "las", "que", "de", "y", "en", "es", "por", "para", "con", "una", "un", "como", "pero", "mi", "yo", "quiero", "tengo", "hola", "gracias", "si", "no", "estoy", "puedo", "cuanto", "cuando", "donde", "llamada", "buenas", "buenos", "dias", "tardes", "noches", "usted", "necesito", "ayuda", "sesion", "terapia", "me", "te", "se", "lo", "muy", "bien"],
  en: ["the", "and", "is", "are", "you", "i", "my", "to", "of", "it", "this", "that", "with", "for", "have", "want", "need", "can", "how", "what", "when", "where", "please", "thanks", "thank", "hello", "hi", "would", "like", "call", "session", "price", "much", "do", "does", "your", "me", "am", "speak", "english", "be", "help", "know", "about", "there"],
  pt: ["voce", "nao", "sim", "obrigado", "obrigada", "eu", "muito", "quero", "preciso", "tenho", "uma", "um", "com", "para", "isso", "esta", "estou", "como", "quanto", "custa", "ola", "bom", "dia", "boa", "tarde", "noite", "falar", "portugues", "ajuda", "sessao", "minha", "meu", "fazer", "pode", "posso", "agora", "tambem", "entao", "voces", "consulta", "ligacao"],
  fr: ["je", "vous", "tu", "est", "les", "des", "une", "pour", "avec", "pas", "merci", "bonjour", "suis", "veux", "voudrais", "besoin", "combien", "quand", "comment", "parle", "francais", "aide", "seance", "rendez", "mon", "ma", "mes", "oui", "non", "c'est", "et", "dans", "sur"],
  it: ["io", "sono", "voglio", "grazie", "buongiorno", "ciao", "quanto", "costa", "come", "perche", "non", "si", "il", "lo", "gli", "della", "per", "con", "una", "parlo", "italiano", "aiuto", "seduta", "chiamata", "vorrei", "ho", "bisogno"],
  de: ["ich", "sie", "du", "und", "ist", "nicht", "danke", "hallo", "guten", "tag", "bitte", "wie", "viel", "kostet", "mochte", "brauche", "hilfe", "sprechen", "deutsch", "termin", "mit", "fur", "das", "die", "der", "ein", "eine"],
};

const SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v)])) as Record<OtherLanguage | "es", Set<string>>;

export const LANGUAGE_NAME: Record<OtherLanguage, { es: string; own: string }> = {
  en: { es: "inglés", own: "English" },
  pt: { es: "portugués", own: "português" },
  fr: { es: "francés", own: "français" },
  it: { es: "italiano", own: "italiano" },
  de: { es: "alemán", own: "Deutsch" },
};

export const detectOtherLanguage = (texts: (string | null | undefined)[]): OtherLanguage | null => {
  const words = foldForSearch(texts.filter(Boolean).join(" "))
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z']+/)
    .filter((w) => w.length > 0);
  if (words.length < 3) return null;
  const score = (lang: OtherLanguage | "es") => words.filter((w) => SETS[lang].has(w)).length;
  const es = score("es");
  let best: { lang: OtherLanguage; n: number } | null = null;
  for (const lang of Object.keys(LANGUAGE_NAME) as OtherLanguage[]) {
    const n = score(lang);
    if (!best || n > best.n) best = { lang, n };
  }
  // Claramente otro idioma: al menos 3 palabras suyas y más que las de español.
  return best && best.n >= 3 && best.n > es * 1.5 ? best.lang : null;
};

/** La línea del prompt cuando escribe en otro idioma. */
export const languageLine = (lang: OtherLanguage | null, toldSpanish: boolean): string | null =>
  lang
    ? `IDIOMA — LA PERSONA ESCRIBE EN ${LANGUAGE_NAME[lang].es.toUpperCase()}: escribe TODO tu mensaje en ${LANGUAGE_NAME[lang].es} (${LANGUAGE_NAME[lang].own}), también el saludo y la presentación: traduce «Hola, te bendigo. Soy la asistente de Dayana» y cualquier frase de las reglas a ${LANGUAGE_NAME[lang].es}; ni una palabra en español. Mismo tono de la asistente (corto, cálido, sin apodos). ${
        toldSpanish
          ? "Ya se le dijo que Dayana atiende en español: no lo repitas."
          : `En este mensaje dile, en ${LANGUAGE_NAME[lang].es} y en una frase corta, que Dayana atiende sus llamadas y sesiones en español.`
      } Si el sistema pega una lista de horas, va en español con números: no la traduzcas, solo dile en ${LANGUAGE_NAME[lang].es} que responda con el número de la hora que prefiera. Los datos de pago y los enlaces van tal cual.`
    : null;

/** ¿Alguno de nuestros mensajes ya le dijo que Dayana atiende en español? */
export const toldSpanishOnly = (ourTexts: (string | null | undefined)[]): boolean =>
  ourTexts.some((t) => /\b(spanish|espanhol|espanol|espagnol|spagnolo|spanisch)\b/.test(foldForSearch(t ?? "")));
