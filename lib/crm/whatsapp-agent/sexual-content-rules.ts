import { plainLetters } from "./rude-reply";

/**
 * Contenido sexual por WhatsApp: totalmente restringido (owner, 8-nov: «el
 * tema de envío de contenido sexual tiene que ser totalmente restringido… se
 * borre el chat automáticamente, se bloquee y se reporte»; Roldán).
 *
 * Reglas puras (sin base ni red). Lo que hace el bloqueo está en
 * `sexual-content.ts`; la revisión de fotos y videos con Gemini en
 * `content-screen.ts`.
 *
 * Falsos positivos: Dayana es terapeuta. Hablar de sexualidad, abuso, el
 * cuerpo, la pareja, la autoestima o un problema médico NO es contenido
 * sexual. Por eso el texto solo bloquea cuando es inequívoco: pedir fotos o
 * videos íntimos, proponer sexo a quien recibe, describir actos o genitales
 * dirigidos a ella, o un enlace porno. Lo demás que solo «suena» a sexual
 * (`sexualHint`) lo decide un modelo con instrucciones de no confundir
 * terapia con acoso, y aun así solo con confianza alta.
 */

/** Qué lo detectó (va a la fila de bloqueo; nunca el contenido). */
export type SexualSignal =
  | { source: "vision"; reason: string }
  | { source: "text"; reason: string }
  /** Dayana lo marcó desde el CRM (lo que el filtro no vio). */
  | { source: "staff"; reason: string };

export const signalLabel = (s: SexualSignal): string => `${s.source}:${s.reason}`.slice(0, 120);

/** Minúsculas, sin tildes, sin letras «de adorno» (𝓈𝑒𝓍𝑜, ᴘᴀᴄᴋ), espacios simples. */
export const plainText = (text: string): string =>
  plainLetters(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Pedir fotos/videos íntimos o «pack» a quien recibe.
const ASK_VERB = String.raw`(?:mand|envi|pas|ensen|muestr|regal)a(?:me|nos)?|(?:mand|envi|pas)ame|quiero ver|dejame ver|me (?:mandas|envias|pasas|muestras|ensenas)`;
const NUDE_MEDIA = String.raw`(?:fotos?|videos?|fotitos?|videitos?|imagen(?:es)?|selfies?)\s+(?:tuyas?\s+|tuyos?\s+)?(?:desnud[ao]s?|sin ropa|en (?:ropa interior|tanga|hilo|calzones|brasier|bra)|intim[ao]s?|hot|calientes?|xxx|de tus? (?:tetas|senos|nalgas|cola|culo|partes|vagina|chocha|cuca|pene|pecho))`;
const NUDE_ASK = new RegExp(String.raw`\b(?:${ASK_VERB})\b.{0,25}\b(?:${NUDE_MEDIA}|(?:el |un |tu )?pack\b|nudes?\b)`);
// Proponer sexo / actos sexuales a quien recibe.
const PROPOSITION = new RegExp(
  String.raw`\b(?:quiero|quisiera|me gustaria|vamos a|te voy a|deja(?:me)?|dejate)\s+(?:follarte|culearte|cogerte|comerte (?:toda|enterita|el culo|la cuca|la chocha)|chupartela|mamartela|metertela|chuparte (?:toda|las tetas|la cuca|la chocha|el culo)|hacerte (?:el amor|mia|mio|venir)|tener sexo contigo|sexo contigo|tirarte|cogermela|follarmela)\b`
);
// Genitales + acto, dirigido («chúpame la…», «mira mi verga…», «se me paró»).
const DIRECTED_ACT = new RegExp(
  String.raw`\b(?:chupa(?:me|mela)?|mama(?:me|mela)|lame(?:me)?|tocame|agarrame|sientate en)\s+(?:la |el |mi )?(?:verga|pene|pito|polla|pinga|vagina|chocha|cuca|concha|panocha|clitoris|culo|tetas|huevos)\b|\b(?:mira|ve|te muestro|te enseno|quieres ver)\s+(?:mi |la )?(?:verga|pito|polla|pinga|pene)\b|\bmi (?:verga|pito|polla|pinga) (?:esta|bien) (?:dura|parada|grande)\b|\bme (?:la )?(?:pusiste|tienes) (?:dura|parada)\b|\bestoy (?:bien )?(?:caliente|arrecho|arrecha|excitad[oa]) (?:por|contigo|pensando en ti)\b`
);
// Ofrecer o vender contenido sexual / cibersexo.
const SEX_OFFER = new RegExp(
  String.raw`\b(?:sexo (?:virtual|por (?:video|videollamada|camara))|videollamada (?:hot|caliente|desnud[ao]|xxx|sin ropa)|sexting|vendo (?:pack|contenido (?:hot|\+18|xxx))|contenido (?:\+18|xxx|para adultos)|onlyfans\.com|pornhub|xvideos|xnxx|xhamster|chaturbate)\b`
);

/** Texto sexual inequívoco (bloquea sin más). Devuelve qué regla saltó, o null. */
export const explicitSexualText = (text: string | null | undefined): string | null => {
  if (!text?.trim()) return null;
  const t = plainText(text);
  if (NUDE_ASK.test(t)) return "nude_request";
  if (PROPOSITION.test(t)) return "proposition";
  if (DIRECTED_ACT.test(t)) return "directed_act";
  if (SEX_OFFER.test(t)) return "sexual_offer";
  return null;
};

/**
 * Palabras que podrían ser sexuales (o no: «abuso sexual», «coger el bus»).
 * Solo deciden si vale la pena preguntarle al modelo (`classifySexualText`).
 */
const HINT = new RegExp(
  String.raw`\b(?:sexo|sexual|sexy|desnud|nudes?|pack|porno|xxx|\+18|caliente|arrech|excitad|verga|pene|pito|polla|pinga|vagina|chocha|cuca|tetas|senos|nalgas|culo|follar|coger(?:te|la)|culear|chupar|mamar|orgasm|masturb|hot|onlyfans|intim[ao]s?|cama contigo|besarte|lencer|tanga|parad[ao]|que (?:llevas|tienes) puesto|ropa interior|mamacita|mami rica|bien ric[ao]|que ric[ao]|bebe hermos|bb hermos)|[🍆🍑💦👅😈]`,
  "u"
);
export const sexualHint = (text: string | null | undefined): boolean => Boolean(text?.trim()) && HINT.test(plainText(text!));

/** Lo que contestó el modelo al revisar un texto dudoso. */
export type TextVerdict = { explicit: boolean; kind: string; confidence: number };

/**
 * ¿Bloquear por lo que dijo el modelo? Solo si es explícito, dirigido a quien
 * recibe (acoso, propuesta, pedir/ofrecer contenido) y con confianza ≥ 0.85;
 * terapia, salud, abuso contado como víctima o la pareja propia nunca.
 */
export const textVerdictBlocks = (v: TextVerdict | null): boolean =>
  Boolean(v && v.explicit && v.confidence >= 0.85 && !["therapy", "medical", "victim", "none", "other"].includes(v.kind));

/** Lo que devolvió Gemini al mirar una foto, sticker o video. */
export type MediaScreenRaw = {
  /** `promptFeedback.blockReason` (pedido bloqueado entero). */
  blockReason?: string | null;
  /** `finishReason` crudo de Google (o del SDK). */
  finishReason?: string | null;
  /** `safetyRatings` (de la respuesta o del `promptFeedback`). */
  ratings?: { category?: string | null; probability?: string | null; blocked?: boolean | null }[] | null;
  /** La respuesta del modelo (JSON) si contestó. */
  answer?: { sexual?: boolean; nudity?: boolean; confidence?: number } | null;
  /** No se pudo revisar (sin clave, timeout, error). */
  error?: string | null;
};

export type MediaVerdict = { verdict: "sexual" | "ok" | "unknown"; reason: string };

const sexualRating = (raw: MediaScreenRaw) =>
  (raw.ratings ?? []).find((r) => r.category === "HARM_CATEGORY_SEXUALLY_EXPLICIT") ?? null;

/**
 * Decide con lo que devolvió Gemini (pura). La llamada lleva SOLO el archivo y
 * una pregunta neutra, sin la conversación: si Google la bloquea, el motivo
 * es el archivo (en los chats largos Google bloqueó a veces el texto solo —
 * Adrienne, 26-oct —, por eso un bloqueo de una conversación NO cuenta).
 */
export const mediaVerdict = (raw: MediaScreenRaw): MediaVerdict => {
  if (raw.error) return { verdict: "unknown", reason: `error:${raw.error}`.slice(0, 80) };
  const rating = sexualRating(raw);
  const block = (raw.blockReason ?? "").toUpperCase();
  const finish = (raw.finishReason ?? "").toUpperCase();
  // PROHIBITED_CONTENT en una imagen sola: lo que Google nunca deja pasar (sobre todo abuso infantil).
  if (block === "PROHIBITED_CONTENT" || finish === "PROHIBITED_CONTENT" || finish === "IMAGE_PROHIBITED_CONTENT") {
    return { verdict: "sexual", reason: "PROHIBITED_CONTENT" };
  }
  if (block === "IMAGE_SAFETY" || finish === "IMAGE_SAFETY") return { verdict: "sexual", reason: "IMAGE_SAFETY" };
  if (block === "SAFETY" || finish === "SAFETY") {
    // Bloqueado por seguridad: es sexual solo si la categoría sexual es la que saltó.
    if (rating && (rating.blocked || ["HIGH", "MEDIUM"].includes((rating.probability ?? "").toUpperCase()))) {
      return { verdict: "sexual", reason: `SAFETY:${(rating.probability ?? "blocked").toUpperCase()}` };
    }
    return { verdict: "unknown", reason: "SAFETY:other" };
  }
  if (rating && (rating.probability ?? "").toUpperCase() === "HIGH") return { verdict: "sexual", reason: "RATING:HIGH" };
  const a = raw.answer;
  if (a && a.sexual === true && (a.confidence ?? 0) >= 0.8) {
    return { verdict: "sexual", reason: `MODEL:${a.nudity ? "nudity" : "sexual"}` };
  }
  if (a && typeof a.sexual === "boolean") return { verdict: "ok", reason: "MODEL:ok" };
  if (block || finish === "OTHER" || finish === "BLOCKLIST") return { verdict: "unknown", reason: `BLOCK:${block || finish}` };
  return { verdict: "unknown", reason: "no_answer" };
};

/** Los adjuntos que se revisan antes de guardarlos. */
export const isScreenableAttachment = (kind: string | null | undefined, mimeType: string | null | undefined): boolean => {
  const mime = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (kind === "image" || kind === "sticker") return mime.startsWith("image/") || mime === "";
  if (kind === "video") return mime.startsWith("video/") || mime === "";
  return false;
};

/**
 * El único mensaje que recibe la persona, con las palabras de la dueña («va a
 * ser reportado el número debido a estas acciones»). Reportar a WhatsApp solo
 * se puede desde la app del celular: lo hace Dayana (el aviso le pide hacerlo),
 * por eso dice «va a ser reportado» y no «fue reportado».
 */
export const SEXUAL_CONTENT_NOTICE =
  "Este número va a ser reportado a WhatsApp y Meta debido a estas acciones: aquí no se permite enviar contenido sexual. A partir de ahora el número queda bloqueado.";

/** Quién no se bloquea solo (un número personal de Dayana, su equipo): solo se le avisa a ella. */
export const sparedFromAutoBlock = (input: { personalNumber: boolean; category: string | null }): boolean =>
  input.personalNumber || input.category === "personal" || input.category === "equipo";
