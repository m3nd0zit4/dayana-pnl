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

// Pedir fotos/videos íntimos a quien recibe. Solo en segunda persona dirigida
// («mándame», «me mandas»): «mi novio me manda fotos desnudas» es lo que le
// pasó, no un pedido (revisión 8-nov). «Pack» solo con algo que lo haga íntimo
// («tu pack», «pack de fotos»): «el pack de sesiones» es el de Dayana.
const ASK_VERB = String.raw`(?:mand|envi|pas|ensen|muestr|regal)a(?:me|nos)|quiero ver|dejame ver|me (?:mandas|envias|pasas|muestras|ensenas|regalas)`;
const NUDE_MEDIA = String.raw`(?:fotos?|videos?|fotitos?|videitos?|imagen(?:es)?|selfies?)\s+(?:tuyas?\s+|tuyos?\s+)?(?:desnud[ao]s?|sin ropa|en (?:ropa interior|tanga|hilo|calzones|brasier|bra)|intim[ao]s?|hot|xxx|de tus? (?:tetas|senos|nalgas|cola|culo|partes|vagina|chocha|cuca|pene|pecho))`;
const NUDE_PACK = String.raw`tu pack(?:cito)?\b|pack(?:cito)? (?:de (?:fotos|videos|nudes)|hot|xxx|\+18|intimo|caliente)|nudes?\b`;
const NUDE_ASK = new RegExp(String.raw`\b(?:${ASK_VERB})\b.{0,25}\b(?:${NUDE_MEDIA}|${NUDE_PACK})`);
// Proponer sexo / actos sexuales a quien recibe.
const PROPOSITION = new RegExp(
  String.raw`\b(?:quiero|quisiera|me gustaria|vamos a|te voy a|deja(?:me)?|dejate)\s+(?:follarte|culearte|comerte (?:toda|enterita|el culo|la cuca|la chocha)|chupartela|mamartela|metertela|chuparte (?:toda|las tetas|la cuca|la chocha|el culo)|hacerte (?:el amor|venir)|tener sexo contigo|sexo contigo|follarmela)\b`
);
// Genitales + acto, dirigido («chúpame la…», «mira mi verga…»). Sin «estoy
// caliente/arrecho…»: en Colombia «caliente» es enojado y en Perú «arrecho»
// también (lo decide el modelo).
const DIRECTED_ACT = new RegExp(
  String.raw`\b(?:chupa(?:me|mela)|mama(?:me|mela)|lame(?:me)|tocame|agarrame|sientate en)\s+(?:la |el |mi )?(?:verga|pene|pito|polla|pinga|vagina|chocha|cuca|concha|panocha|clitoris|culo|tetas|huevos)\b|\b(?:mira|te muestro|te enseno|quieres ver)\s+(?:mi |la )?(?:verga|pito|polla|pinga)\b|\bmi (?:verga|pito|polla|pinga) (?:esta|bien) (?:dura|parada)\b|\bme (?:la )?(?:pusiste|tienes) (?:dura|parada)\b`
);
// Ofrecer, vender o proponer contenido sexual / cibersexo (con el verbo: «mi
// esposo ve pornhub» o «tengo adicción al sexo virtual» son su tema de terapia).
const SEX_OFFER = new RegExp(
  String.raw`\b(?:vendo|ofrezco|te (?:vendo|ofrezco|mando|paso)|hacemos|hagamos|quieres hacer|te gustaria hacer)\s+(?:un |una |el |mi )?(?:sexo (?:virtual|por (?:video|videollamada|camara))|videollamada (?:hot|caliente|desnud[ao]|xxx|sin ropa)|sexting|pack(?:s|cito)?|contenido (?:hot|\+18|xxx|para adultos))\b|https?:\/\/\S*(?:onlyfans\.com|pornhub|xvideos|xnxx|xhamster|chaturbate)`
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
  String.raw`\b(?:sexo|sexual|sexy|desnud|nudes?|pack|porno|xxx|\+18|caliente|arrech|excitad|verga|pene|pito|polla|pinga|vagina|chocha|cuca|tetas|senos|nalgas|culo|follar|coger(?:te|la)|culear|chupar|mamar|orgasm|masturb|hot|onlyfans|pornhub|xvideos|sexting|intim[ao]s?|cama contigo|besarte|lencer|tanga|parad[ao]|que (?:llevas|tienes) puesto|ropa interior|mamacita|mami rica|bien ric[ao]|que ric[ao]|bebe hermos|bb hermos)|[🍆🍑💦👅😈]`,
  "u"
);
export const sexualHint = (text: string | null | undefined): boolean => Boolean(text?.trim()) && HINT.test(plainText(text!));

/**
 * Acoso o intención íntima con Dayana (owner, 16-nov, Mehmet: «Hola mi amor, vi
 * tus fotos… eres maravillosa, esbelta», «Me gustas mucho Dayana», «Necesito una
 * novia»: «tenemos que bloquear a la gente que quiere acosar o tener una
 * intención íntima con Dayana»). Estas palabras solo deciden preguntarle al
 * modelo: una clienta que le escribe «te quiero mucho, eres hermosa, gracias por
 * todo» o alguien que quiere sanar para encontrar pareja no es acoso.
 */
const INTIMACY_HINT = new RegExp(
  String.raw`\b(?:mi amor|amor mio|mi vida|mi reina|mi princesa|princesa|preciosa|mamacita|bombon|me gustas|me encantas|me fascinas|estoy (?:enamorad[oa]|loco por ti)|me enamore de ti|te amo|te deseo|te quiero conocer|quiero conocerte|conocerte (?:mejor|en persona)|salir (?:contigo|conmigo)|una cita contigo|(?:invitarte|te invito) a (?:salir|cenar|tomar|un cafe)|(?:muy|tan|mucho|super) (?:hermosa|linda|bella|guapa|preciosa|sexy)|ser mi (?:novia|esposa|pareja)|quieres ser mi|necesito una (?:novia|esposa|mujer)|casate conmigo|casarnos|un beso|besos?\b|besarte|abrazarte|vi tus fotos|tus fotos|tu foto|tu cuerpo|esbelta|eres (?:muy |tan |la mas )?(?:hermosa|linda|bella|guapa|bonita|sexy|preciosa)|que (?:hermosa|linda|bella|guapa|bonita) eres)|[😍😘💋🥰😻]`,
  "u"
);
export const intimacyHint = (text: string | null | undefined): boolean => Boolean(text?.trim()) && INTIMACY_HINT.test(plainText(text!));

/** ¿El bloqueo fue por acoso / intención íntima (no por contenido sexual)? Cambia el aviso. */
export const isHarassmentSignal = (s: SexualSignal): boolean => /romantic_advance|harassment/.test(s.reason);

/** Lo que contestó el modelo al revisar un texto dudoso. */
export type TextVerdict = { explicit: boolean; kind: string; confidence: number };

/**
 * ¿Bloquear por lo que dijo el modelo? Solo si es explícito, dirigido a quien
 * recibe (acoso, propuesta, pedir/ofrecer contenido) y con confianza ≥ 0.85;
 * terapia, salud, abuso contado como víctima o la pareja propia nunca.
 */
export const textVerdictBlocks = (v: TextVerdict | null): boolean =>
  Boolean(
    v &&
      v.explicit &&
      // El acoso romántico es más ambiguo que lo sexual («eres muy linda, me encantó la
      // llamada» salió 0.85 en el eval del 16-nov): pide casi certeza.
      v.confidence >= (v.kind === "romantic_advance" ? 0.95 : 0.85) &&
      !["therapy", "medical", "victim", "none", "other"].includes(v.kind)
  );

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
  const prob = (rating?.probability ?? "").toUpperCase();
  const block = (raw.blockReason ?? "").toUpperCase();
  const finish = (raw.finishReason ?? "").toUpperCase();
  const a = raw.answer;
  const modelSays = a && typeof a.sexual === "boolean" ? (a.sexual && (a.confidence ?? 0) >= 0.8 ? "sexual" : a.sexual ? "maybe" : "no") : null;
  // PROHIBITED_CONTENT sobre una imagen sola: lo que Google nunca deja pasar (sobre todo abuso infantil).
  if (block === "PROHIBITED_CONTENT" || finish === "PROHIBITED_CONTENT" || finish === "IMAGE_PROHIBITED_CONTENT") {
    return { verdict: "sexual", reason: "PROHIBITED_CONTENT" };
  }
  // Borrar es irreversible: lo demás necesita que la señal sexual sea la que saltó
  // y que el modelo no diga lo contrario (revisión 8-nov).
  if (block === "SAFETY" || finish === "SAFETY" || block === "IMAGE_SAFETY" || finish === "IMAGE_SAFETY") {
    if (rating && (rating.blocked || prob === "HIGH" || prob === "MEDIUM")) {
      return { verdict: "sexual", reason: `${block || finish}:${prob || "blocked"}` };
    }
    return { verdict: "unknown", reason: `${block || finish}:other` };
  }
  if (prob === "HIGH" && modelSays === "sexual") return { verdict: "sexual", reason: "RATING:HIGH+MODEL" };
  if (modelSays === "sexual" && (!rating || prob === "MEDIUM" || prob === "HIGH")) {
    return { verdict: "sexual", reason: `MODEL:${a?.nudity ? "nudity" : "sexual"}${prob ? `+${prob}` : ""}` };
  }
  if (prob === "HIGH" || modelSays === "sexual") return { verdict: "unknown", reason: `DISAGREE:${prob || "-"}:${modelSays}` };
  if (modelSays) return { verdict: "ok", reason: "MODEL:ok" };
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

/** Lo mismo para el acoso o la intención íntima con Dayana (owner, 16-nov). */
export const HARASSMENT_NOTICE =
  "Este número va a ser reportado a WhatsApp y Meta debido a estas acciones: este es un canal profesional y aquí no se permite el acoso ni los mensajes con intención romántica o íntima hacia Dayana. A partir de ahora el número queda bloqueado.";

export const blockNoticeFor = (s: SexualSignal): string => (isHarassmentSignal(s) ? HARASSMENT_NOTICE : SEXUAL_CONTENT_NOTICE);

/** Quién no se bloquea solo (un número personal de Dayana, su equipo): solo se le avisa a ella. */
export const sparedFromAutoBlock = (input: { personalNumber: boolean; category: string | null }): boolean =>
  input.personalNumber || input.category === "personal" || input.category === "equipo";
