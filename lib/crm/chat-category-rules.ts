/**
 * Clasificación de los chats de WhatsApp, en reglas puras (sin base de datos
 * ni modelo): las usan el servidor, el script de vista previa y las pruebas.
 *
 * El principio: una etiqueta que SILENCIA (personal, negocio, equipo) mal
 * puesta deja sin respuesta a una clienta o a una interesada. Ante la duda,
 * nunca se silencia: se le pasa al modelo con una pista, o se marca «revisar».
 *
 * Por eso las reglas solo deciden:
 * - lo que dice el CRM (pagó, agendó, hizo la autoevaluación, se inscribió a
 *   un evento y solo agradece), que nunca silencia;
 * - `equipo` por un número que el equipo puso en Ajustes;
 * - `negocio` solo para códigos de verificación y notificaciones de banco o
 *   app con su estructura real (marca + monto / «te informa»), y solo si TODO
 *   lo que escribió es eso.
 * Respuestas automáticas, bots, publicidad, enlaces, la libreta del celular o
 * un perfil con nombre de marca son pistas para el modelo, no decisiones.
 *
 * Un chat donde la persona nunca escribió solo se clasifica por el CRM: si no
 * hay nada, es `otro` (solo le escribimos nosotros).
 */

export const CHAT_CATEGORIES = [
  "cliente",
  "interesada",
  "comunidad",
  "personal",
  "negocio",
  "equipo",
  "otro",
] as const;

export type ChatCategory = (typeof CHAT_CATEGORIES)[number];

export const isChatCategory = (v: unknown): v is ChatCategory =>
  typeof v === "string" && (CHAT_CATEGORIES as readonly string[]).includes(v);

/** Lo que se ve en los filtros y en la cabecera del chat. */
export const CHAT_CATEGORY_LABEL: Record<ChatCategory, string> = {
  cliente: "Cliente",
  interesada: "Interesada",
  comunidad: "Comunidad",
  personal: "Personal",
  negocio: "Negocio",
  equipo: "Equipo",
  otro: "Otro",
};

/** rule | ai | manual. `manual` nunca se pisa. */
export type CategorySource = "rule" | "ai" | "manual";

/** Categorías a las que la IA no contestaría y que no cuentan en «Te toca» (fase B2). */
export const SILENT_CATEGORIES: readonly ChatCategory[] = ["personal", "negocio", "equipo"];

export const isSilentCategory = (c: string | null | undefined): boolean =>
  Boolean(c && (SILENT_CATEGORIES as readonly string[]).includes(c));

/** Por debajo de esto, la etiqueta se marca «revisar». Más exigente para las que silencian. */
export const REVIEW_BELOW = 0.7;
export const REVIEW_BELOW_SILENT = 0.9;

export const needsReview = (category: ChatCategory, confidence: number): boolean =>
  confidence < (isSilentCategory(category) ? REVIEW_BELOW_SILENT : REVIEW_BELOW);

/**
 * ¿Esta etiqueta puede silenciar el chat (fase B2)? Solo si es segura:
 * puesta a mano, o un número del equipo / un código o notificación detectado
 * por regla, o la IA (personal / negocio) — estas dos últimas con confianza
 * ≥ 0,9 y sin «revisar». Cualquier otra cosa —incluida una etiqueta vieja o
 * rara— no silencia.
 *
 * `enabled`: si la clasificación está apagada (`whatsapp.classify_enabled`),
 * nada silencia: las etiquetas se quedan, pero solo informan. Es obligatorio
 * para que quien la use (B2) no se olvide de mirarlo.
 */
export const isSilencingCategory = (
  c: {
    category: string | null | undefined;
    categorySource: string | null | undefined;
    categoryConfidence?: number | null;
    categoryReview?: boolean | null;
  },
  opts: { enabled: boolean }
): boolean => {
  if (!opts.enabled || !isSilentCategory(c.category)) return false;
  if (c.categorySource === "manual") return true;
  const sure = (c.categoryConfidence ?? 0) >= REVIEW_BELOW_SILENT && !c.categoryReview;
  if (c.categorySource === "rule") return (c.category === "equipo" || c.category === "negocio") && sure;
  if (c.categorySource === "ai") return (c.category === "personal" || c.category === "negocio") && sure;
  return false;
};

export type CategorySignals = {
  /** El número está en Ajustes → equipo (`whatsapp.team_phones`). */
  isTeamPhone?: boolean;
  /** Matrícula ACTIVE/COMPLETED con importe mayor que cero. */
  hasPaidEnrollment?: boolean;
  /** Tipo de lo que pagó, para el motivo. */
  paidKind?: string | null;
  hasApprovedPayment?: boolean;
  /** Matrícula ACTIVE/COMPLETED sin importe (gratis o a mano): pista, no «cliente». */
  hasUnpaidActiveEnrollment?: boolean;
  /** Cita del calendario con contador de paquete («3/8»), no la gratis (0/0). */
  hasTherapySession?: boolean;
  /** Matrícula LEAD: pidió información de un servicio. */
  hasLeadEnrollment?: boolean;
  /** Matrícula PENDING_PAYMENT: empezó a pagar y no terminó. */
  hasPendingPayment?: boolean;
  hasDiagnostic?: boolean;
  /** Llamada gratis agendada (por la IA o en el calendario con 0/0). */
  hasBooking?: boolean;
  hasWebinarRegistration?: boolean;
  /** Miembro (o invitado) de una comunidad de WhatsApp de Dayana. */
  communityMember?: boolean;
  /** Está en la libreta del celular. Solo pista: Dayana también guarda a sus clientas. */
  inAddressBook?: boolean;
};

export type CategoryMessage = {
  direction: string;
  body: string | null;
  /** message | system (aviso gris: reacción, encuesta…). */
  kind?: string | null;
  isEcho?: boolean;
  isAutoReply?: boolean;
  source?: string | null;
  attachments?: unknown;
};

export type CategoryVerdict = {
  category: ChatCategory;
  confidence: number;
  reason: string;
};

export type ChatFacts = {
  signals: CategorySignals;
  /** En cualquier orden: a las reglas no les importa. */
  messages: CategoryMessage[];
  /** Nombre de perfil de WhatsApp (lo único que da el webhook, además del número). */
  participantName?: string | null;
  /**
   * La persona escribió alguna vez (aunque no esté entre los mensajes
   * cargados). Sin esto, se mira solo `messages`.
   */
  everWrote?: boolean;
};

// ── Teléfonos del equipo ──────────────────────────────────────────────────

/**
 * «+57 300 123 4567» → «+573001234567». Sin «+»: 10 dígitos que empiezan por 3
 * son un celular de Colombia (+57); 11 o más se toman con su código de país;
 * menos, `null` (falta el código de país).
 */
export const normalizeTeamPhone = (raw: string): string | null => {
  const s = String(raw ?? "").trim();
  const d = s.replace(/\D/g, "");
  // Un 0 al principio o justo después del código de país («+0573…»,
  // «+57 0300…») es el prefijo de larga distancia: no es un E.164 válido.
  if (LEADING_ZERO_RE.test(d)) return null;
  if (s.startsWith("+")) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  if (d.length === 10 && d.startsWith("3")) return `+57${d}`;
  return d.length >= 11 && d.length <= 15 ? `+${d}` : null;
};
const LEADING_ZERO_RE = /^(?:0|10|(?:57|52|54|51|56|58|34|44|49|33)0|(?:59[1-8]|50[2-7])0)/;

/** El valor guardado (JSON de E.164) → lista limpia, sin repetidos. */
export const parseTeamPhones = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((p) => normalizeTeamPhone(String(p))).filter((p): p is string => p !== null))];
  } catch {
    return [];
  }
};

/**
 * Las formas en dígitos en que puede llegar un número como id del chat:
 * México 52 ↔ 521 y Argentina 54 ↔ 549 (igual que `contactPhoneCandidates`).
 */
export const phoneDigitVariants = (phone: string): string[] => {
  const d = phone.replace(/\D/g, "");
  const out = [d];
  if (d.length === 13 && (d.startsWith("521") || d.startsWith("549"))) out.push(`${d.slice(0, 2)}${d.slice(3)}`);
  if (d.length === 12 && (d.startsWith("52") || d.startsWith("54"))) {
    out.push(`${d.slice(0, 2)}${d.startsWith("52") ? "1" : "9"}${d.slice(2)}`);
  }
  return out;
};

/** ¿El hilo (`externalThreadId`) es uno de los números del equipo? */
export const isTeamThread = (threadId: string, teamPhones: string[]): boolean => {
  // Id de usuario de WhatsApp («PE.2290…»): no trae el número.
  if (/^[A-Z]{2}\./.test(threadId)) return false;
  const thread = threadId.replace(/\D/g, "");
  if (!thread) return false;
  return teamPhones.some((p) => phoneDigitVariants(p).includes(thread));
};

// ── Texto ─────────────────────────────────────────────────────────────────

/** Minúsculas, sin tildes (la ñ queda como n: da igual para comparar). */
export const normalizeText = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Enlaces: `http(s)://…`, `www.…` o un dominio en minúsculas seguido de «/»,
 * espacio o fin. Sin mayúsculas ni TLDs que son palabras: «Hola.Me interesa»
 * o «Gracias.Pero» son un punto sin espacio, no un enlace.
 */
const URL_RE =
  /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|co|io|ly|app|shop|store|link|site|online|xyz|info|lat|gl|gle|to)(?:\/\S*)?(?=$|\s)/g;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}‍️⃣]/gu;

export const findUrls = (body: string): string[] => body.match(URL_RE) ?? [];

const attachmentKinds = (attachments: unknown): string[] =>
  Array.isArray(attachments)
    ? attachments.map((a) => String((a as { kind?: unknown })?.kind ?? "unknown"))
    : [];

/** Mensajes que escribió la persona (sin avisos grises ni ecos). */
export const personMessages = (messages: CategoryMessage[]): CategoryMessage[] =>
  messages.filter(
    (m) =>
      m.direction === "INBOUND" &&
      !m.isEcho &&
      (m.kind ?? "message") !== "system" &&
      (Boolean(m.body?.trim()) || attachmentKinds(m.attachments).length > 0)
  );

const hasQuestion = (raw: string) => /[?¿]/.test(raw);

/** Habla una persona de sí misma: «me», «mi», «estoy», «quiero», «tengo»… */
const FIRST_PERSON =
  /\b(?:me|mi|mis|yo|estoy|estaba|quiero|queria|tengo|tenia|necesito|siento|puedo|soy|perdi|perdi|llevo|vivo|trabajo|busco|quisiera|podria|deseo)\b/;

/**
 * Palabras de una interesada o de un pago. Si aparecen, ningún patrón de
 * empresa decide nada: «Nequi: … ahí te pago», «ya te consigné lo de la sesión».
 */
const INTEREST_OR_PAYMENT =
  /\b(?:quiero|quisiera|terapia|terapias|sesion|sesiones|precio|precios|costo|cuesta|cuanto|pagar|pago|pague|pagado|pagaste|consigne|consignaste|consignacion|consignado|transferi|transferiste|te\s+transferi|transferencia\s+que\s+te|envie|enviaste|deposite|depositaste|comprobante|compra|compre|compraste|consulta|curso|taller|cita|agendar|agenda|informacion|ayuda|dayana)\b|\bdesde\s+tu\s+cuenta\b|\ba\s+la\s+(?:cuenta|llave)\b/;

// ── Cortesía: gracias, saludos, bendiciones, emojis ──────────────────────

const COURTESY_WORDS = new Set(
  `gracias gracia muchas muchisimas mil infinitas por todo toda tu su sus la las el los lo le les un una unos
  invitacion compartir recordatorio recordarme link enlace mensaje mensajes clase clases masterclass
  taller evento espacio regalo ensenanza ensenanzas palabras video tiempo charla encuentro conferencia
  hola holi holis buenas buenos buen dia dias tardes noches saludos saludo que tal como estas esta estan
  bendiciones bendicion bendecida bendecido bendecidas bendecidos bendigo bendiga bendice dios amen
  te ti usted ustedes tambien igualmente igual para mi mis nos vemos pronto
  abrazo abrazos besos beso besito feliz fin semana linda lindo hermosa hermoso bella bello preciosa precioso
  querida querido maestra profe dayana dayi day amor corazon reina cielo
  ok okey oki okis vale listo lista perfecto perfecta genial excelente super si claro entendido de acuerdo
  recibido recibida enterada enterado maravilloso maravillosa increible muy bien bueno buena estuvo fue
  me encanto encanta gusto gusta ahi alli estare estaremos alla conectada conectado ya voy y a con en del al
  es son asi sera seguro hermosas hermosos belleza divina divino`.split(/\s+/)
);

const LAUGH_RE = /^(?:j[aeiou])+j?$|^(?:h[aeiou])+h?$/;

const courtesyWord = (w: string): boolean => {
  if (COURTESY_WORDS.has(w) || LAUGH_RE.test(w)) return true;
  const squeezed = w.replace(/(.)\1+/g, "$1");
  return COURTESY_WORDS.has(squeezed) || COURTESY_WORDS.has(w.replace(/(.)\1{2,}/g, "$1"));
};

/**
 * Un mensaje que solo agradece, saluda o bendice (o solo emojis / stickers).
 * Una pregunta, o cualquier palabra fuera del vocabulario de cortesía
 * —«info», «precio», «terapia», «quiero»—, lo deja fuera: eso lo lee el modelo.
 */
export const isCourtesyMessage = (m: CategoryMessage): boolean => {
  const kinds = attachmentKinds(m.attachments);
  if (kinds.some((k) => k !== "sticker")) return false;
  const raw = m.body ?? "";
  if (hasQuestion(raw)) return false;
  const text = normalizeText(raw).replace(EMOJI_RE, " ");
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return true;
  if (words.length > 15) return false;
  return words.every(courtesyWord);
};

// ── Lo que parece de una empresa ──────────────────────────────────────────

/**
 * - `otp`, `notification`: lo único que las reglas deciden (`negocio`).
 * - `auto`, `bot`, `spam`, `link`: pistas para el modelo.
 */
export type NegocioKind = "otp" | "notification" | "auto" | "bot" | "spam" | "link";

/** Marcas que escriben a la gente (bancos, apps, operadores, tiendas, envíos). */
const BRANDS = [
  "rappi", "didi", "uber", "cabify", "indrive", "picap", "ifood", "pedidosya", "glovo",
  "nequi", "daviplata", "bancolombia", "davivienda", "banco de bogota", "bbva", "scotiabank", "colpatria",
  "itau", "banamex", "santander", "lulo bank", "nu colombia", "nu mexico", "bancoomeva", "banco popular",
  "mercado libre", "mercadolibre", "mercado pago", "mercadopago", "paypal", "efecty",
  "claro", "movistar", "tigo", "wom", "etb", "telcel", "entel", "personal flow",
  "netflix", "spotify", "amazon", "temu", "shein", "falabella", "exito", "alkosto", "oxxo",
  "servientrega", "interrapidisimo", "coordinadora", "envia", "dhl", "fedex",
];
/** Palabras, apodos o apellidos («Claro», «Didi», «Santander López»): solo cuentan por el mensaje. */
const AMBIGUOUS_BRANDS = new Set(["didi", "claro", "wom", "exito", "envia", "personal flow", "uber"]);
/** Como nombre de perfil, solo si es exactamente la marca («Coordinadora Académica» es una persona). */
const EXACT_PROFILE_BRANDS = new Set(["santander", "coordinadora", "tigo", "entel"]);

const alternation = (list: string[]) => list.map((b) => b.replace(/\s+/g, "\\s+")).join("|");
const UNAMBIGUOUS = BRANDS.filter((b) => !AMBIGUOUS_BRANDS.has(b));

/** «Bancolombia: …», «[Rappi] …», «Nequi - …» al principio del mensaje. */
const BRAND_PREFIX_RE = new RegExp(`^\\W*\\[?(${alternation(UNAMBIGUOUS)})\\]?\\s*(?::|-|\\||\\])`);
/** «Claro te informa…», «Bancolombia le notifica…». */
const BRAND_INFORMS_RE = new RegExp(`\\b(${alternation(BRANDS)})\\s+(?:te|le)\\s+(?:informa|recuerda|notifica|avisa)\\b`);
/** Lo que trae una notificación de verdad: un monto o su vocabulario. */
/**
 * Lo que dice una notificación de la marca a la persona: dinero que LE llegó
 * o algo de su cuenta. Un monto solo no basta, y lo que la persona pagó o
 * envió («Transferiste $150.000…», «Compra por…») nunca cuenta: es un
 * comprobante que una clienta reenvía.
 */
const NOTIFICATION_BODY_RE =
  /\b(?:recibiste|te\s+(?:enviaron|transfirieron|consignaron|abonaron|llego\s+(?:un|una)\s+(?:pago|transferencia))|(?:transferencia|pago|abono)\s+recibid[oa]|tu\s+(?:pedido|factura|recarga|saldo|plan|suscripcion|paquete\s+de\s+datos))\b/;

const BRAND_LABEL: Record<string, string> = {
  bancolombia: "Bancolombia", nequi: "Nequi", daviplata: "Daviplata", davivienda: "Davivienda",
  rappi: "Rappi", didi: "DiDi", uber: "Uber", "mercado libre": "Mercado Libre", mercadolibre: "Mercado Libre",
  "mercado pago": "Mercado Pago", mercadopago: "Mercado Pago", claro: "Claro", movistar: "Movistar", tigo: "Tigo",
  bbva: "BBVA", paypal: "PayPal", netflix: "Netflix", amazon: "Amazon",
};
const brandLabel = (raw: string) => {
  const key = raw.replace(/\s+/g, " ");
  return BRAND_LABEL[key] ?? key.replace(/\b\w/g, (c) => c.toUpperCase());
};

/** 4 a 8 dígitos, «123-456» (WhatsApp) o «G-123456» (Google). */
const CODE = String.raw`(?:[a-z]-?)?(?:\d{3}[- ]\d{3}|\d{4,8})`;
const DIGITS_CODE = new RegExp(String.raw`\b${CODE}\b`);

const OTP_RES: RegExp[] = [
  new RegExp(
    String.raw`\b(?:tu|su)\s+codigo(?:\s+de\s+(?:verificacion|seguridad|acceso|confirmacion|activacion|whatsapp|ingreso)(?:\s+de\s+\w+)?)?\s*(?:es|:)\s*:?\s*${CODE}\b`
  ),
  new RegExp(String.raw`\b${CODE}\b\s*(?:es|is)\s+(?:tu|su|your)\s+(?:codigo|code)\b`),
  /\bno\s+(?:compartas|comparta)\s+(?:este|tu|su|esta)\s+(?:codigo|clave)/,
  /\bnunca\s+(?:compartas|comparta)\s+(?:este|tu|su)\s+(?:codigo|clave)/,
  /\bdo\s+not\s+share\s+(?:this|your)\s+code\b/,
];
const OTP_PHRASE = /\bcodigo\s+de\s+(?:seguridad|verificacion|acceso|confirmacion|activacion)\b|\b(?:verification|security|login)\s+code\b/;

const AUTO_RES: RegExp[] = [
  /\bgracias\s+por\s+(?:comunicarte|comunicarse)\s+(?:con|a)\b/,
  /\bgracias\s+por\s+(?:contactarnos|escribirnos|preferirnos|elegirnos)\b/,
  /\ben\s+breve\s+(?:te|le|lo|la|nos)?\s*(?:atenderemos|responderemos|contestaremos|contactaremos|comunicaremos|atendera|respondera|pondremos)\b/,
  /\b(?:te|le)\s+(?:responderemos|atenderemos|contactaremos|contestaremos)\s+(?:lo\s+antes\s+posible|lo\s+mas\s+pronto|a\s+la\s+brevedad|en\s+breve|pronto|en\s+un\s+momento)/,
  /\bnuestro\s+horario\s+de\s+atencion\b|\bhorario\s+de\s+atencion\s*(?:es\b|:|de\s+lunes|lunes)|\bfuera\s+de(?:l)?\s+(?:nuestro\s+)?horario\s+de\s+atencion/,
  /\bno\s+(?:responda|respondas|responder)\s+(?:a\s+)?este\s+(?:mensaje|numero|chat|correo)/,
  /\beste\s+numero\s+no\s+(?:recibe|acepta|responde|atiende)\b/,
  /\ben\s+que\s+(?:te\s+|le\s+)?podemos\s+(?:ayudarte|ayudarle|ayudar|servirte|servirle|colaborarte)\b/,
  /\bestamos\s+(?:ausentes|fuera\s+de\s+(?:la\s+)?oficina)\b|\ben\s+este\s+momento\s+no\s+(?:estamos\s+disponibles|podemos\s+atender(?:te|le)?)\b/,
  /\bbienvenid[oa]s?\s+a\s+(?:la\s+linea\s+de|el\s+canal\s+de)\b/,
  /\b(?:este\s+es\s+un|es\s+un|esta\s+es\s+una)\s+(?:mensaje|respuesta)\s+(?:generad[oa]\s+)?automatic[oa]\b/,
];

const BOT_RES: RegExp[] = [
  /\b(?:selecciona|digita|marca|responde\s+con)\s+(?:una\s+|la\s+|el\s+numero\s+de\s+la\s+)?opcion\b/,
  /\bmenu\s+(?:principal|de\s+opciones)\b/,
  /\bver\s+nuestro\s+catalogo\b/,
  /\bnumero\s+de\s+(?:pedido|orden|guia|seguimiento|rastreo)\b/,
];

const SPAM_RES: RegExp[] = [
  /\bgana(?:r)?\s+(?:dinero|plata|\$|desde\s+(?:casa|tu\s+celular))/,
  /\b(?:genera|generar|recibe|recibir)\s+ingresos\b|\bingresos\s+(?:extra|pasivos|diarios)\b/,
  /\bbono\s+(?:de\s+bienvenida|en\s+tu\s+primer\s+deposito)\b|\bprimer\s+deposito\b/,
  /\bcopy\s*trading\b|\btrading\b|\bforex\b|\bcriptomonedas?\b|\bbitcoin\b|\bbinance\b|\busdt\b/,
  /\binversion\s+(?:minima|segura|garantizada)\b|\brentabilidad\s+(?:diaria|garantizada)\b|\bganancias?\s+(?:diarias|garantizadas|aseguradas)\b/,
  /\boferta\s+de\s+(?:empleo|trabajo)\b|\btrabaja\s+desde\s+(?:casa|tu\s+celular)\b/,
  /\b(?:descuento|oferta|promocion|promo)\s+(?:exclusiva|especial|valida|por\s+tiempo\s+limitado|imperdible)\b/,
  /\baprovecha\s+(?:esta|nuestra|nuestras|nuestros)\s+(?:oferta|promo|descuento)|\bultimas\s+unidades\b/,
  /\b(?:hasta|obten|aprovecha|con)\s+(?:un\s+|el\s+)?\d{1,2}\s?%\s+(?:de\s+)?(?:descuento|off|dcto)\b/,
  /\b(?:responde|envia|escribe)\s+(?:baja|stop|salir)\b|\bpara\s+(?:dejar\s+de\s+recibir|no\s+recibir\s+mas)\s+(?:mensajes|promociones|ofertas|notificaciones)\b|\bdarte\s+de\s+baja\b/,
  /\bfelicidades,?\s+(?:has\s+sido|fuiste)\s+(?:seleccionad|el\s+ganador|la\s+ganadora)|\breclama\s+tu\s+premio\b/,
];

/** Enlaces que comparte una persona (un reel, una ubicación, la web de Dayana, un pago). */
const PERSONAL_LINK_RE =
  /instagram|tiktok|youtu|facebook|fb\.watch|x\.com|twitter|spotify|maps|goo\.gl|wa\.me|dayanabeltran|meet\.google|zoom\.us|drive\.google|docs\.google|pin\.it|pinterest|threads|mpago|mercadopago|paypal|nequi|bancolombia|daviplata/;

/**
 * ¿Este mensaje parece de una empresa? `null` si parece de una persona.
 *
 * Una pregunta («¿el horario de atención es…?»), alguien que habla de sí
 * mismo («perdí mi dinero en criptomonedas») o palabras de interés o de pago
 * («ya transferí», «quiero agendar») nunca cuentan como empresa: eso es una
 * persona, aunque use las mismas palabras.
 */
export const negocioSignal = (body: string | null | undefined): { kind: NegocioKind; reason: string } | null => {
  const raw = body?.trim();
  if (!raw) return null;
  const t = normalizeText(raw);
  const personal = hasQuestion(raw) || FIRST_PERSON.test(t) || INTEREST_OR_PAYMENT.test(t);

  if (!personal) {
    if (OTP_RES.some((r) => r.test(t)) || (OTP_PHRASE.test(t) && DIGITS_CODE.test(t))) {
      return { kind: "otp", reason: "Código de verificación" };
    }
    const brand = t.match(BRAND_PREFIX_RE) ?? t.match(BRAND_INFORMS_RE);
    if (brand && NOTIFICATION_BODY_RE.test(t.slice(brand.index! + brand[0].length))) {
      return { kind: "notification", reason: `Notificación de ${brandLabel(brand[1])}` };
    }
  }
  // Lo que sigue solo da pistas al modelo; aun así, sin falsos positivos.
  if (hasQuestion(raw) || FIRST_PERSON.test(t)) return null;
  if (AUTO_RES.some((r) => r.test(t))) return { kind: "auto", reason: "Respuesta automática de una empresa" };
  if (BOT_RES.some((r) => r.test(t))) return { kind: "bot", reason: "Menú o pedidos de un bot" };

  const urls = findUrls(raw);
  const spamHits = SPAM_RES.filter((r) => r.test(t)).length;
  // Publicidad: un patrón y algo estructural (enlace, precio, código corto), o varios.
  if (spamHits >= 2 || (spamHits === 1 && (urls.length > 0 || /\$|%|\b\d{4,6}\b/.test(t)))) {
    return { kind: "spam", reason: "Publicidad o spam" };
  }
  if (urls.length > 0) {
    const rest = normalizeText(raw.replace(URL_RE, " ")).replace(EMOJI_RE, " ");
    const words = rest.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length <= 6 && !urls.some((u) => PERSONAL_LINK_RE.test(u.toLowerCase()))) {
      return { kind: "link", reason: "Solo envía enlaces" };
    }
  }
  return null;
};

/** Nombre de perfil que es una marca («Bancolombia», «Rappi Colombia»). Solo pista. */
export const brandProfile = (name: string | null | undefined): string | null => {
  const t = normalizeText(name?.trim() ?? "").replace(EMOJI_RE, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const b of BRANDS) {
    if (AMBIGUOUS_BRANDS.has(b)) continue;
    if (t === b || (!EXACT_PROFILE_BRANDS.has(b) && t.startsWith(`${b} `))) return brandLabel(b);
  }
  return null;
};

// ── Reglas ────────────────────────────────────────────────────────────────

const PAID_REASON: Record<string, string> = {
  THERAPY: "Pagó un paquete",
  COURSE: "Pagó el curso",
  WORKSHOP: "Pagó un taller",
};

/**
 * Solo lo que decide el CRM (sin mirar mensajes): equipo, cliente o
 * interesada. Es lo que se vuelve a mirar en cada vuelta del reloj, para que
 * quien paga o agenda deje de estar en una categoría vieja.
 */
export const crmVerdict = (s: CategorySignals): CategoryVerdict | null => {
  if (s.isTeamPhone) return { category: "equipo", confidence: 1, reason: "Número del equipo" };
  if (s.hasPaidEnrollment) {
    return { category: "cliente", confidence: 0.98, reason: PAID_REASON[s.paidKind ?? ""] ?? "Pagó un paquete" };
  }
  if (s.hasApprovedPayment) return { category: "cliente", confidence: 0.97, reason: "Tiene un pago aprobado" };
  if (s.hasTherapySession) {
    return { category: "cliente", confidence: 0.9, reason: "Tiene sesiones de terapia en el calendario" };
  }
  // Activa o terminada pero sin importe ni pago: puesta a mano o gratis.
  // Probablemente clienta, con menos certeza (nunca silencia).
  if (s.hasUnpaidActiveEnrollment) {
    return { category: "cliente", confidence: 0.8, reason: "Tiene una inscripción activa sin pago registrado" };
  }
  if (s.hasBooking) return { category: "interesada", confidence: 0.92, reason: "Agendó la llamada gratis" };
  if (s.hasDiagnostic) return { category: "interesada", confidence: 0.9, reason: "Hizo la autoevaluación" };
  if (s.hasPendingPayment) return { category: "interesada", confidence: 0.88, reason: "Empezó a pagar y no terminó" };
  if (s.hasLeadEnrollment) return { category: "interesada", confidence: 0.85, reason: "Pidió información de un servicio" };
  return null;
};

/** Su propio contestador o un código: no es algo que la persona «dijo». */
const isOwnAutomatic = (m: CategoryMessage) => {
  const kind = negocioSignal(m.body)?.kind;
  return kind === "auto" || kind === "otp";
};

/**
 * La categoría por reglas, o `null` si no está claro (lo decide el modelo).
 *
 * Orden: CRM (equipo → cliente → interesada) → comunidad → negocio (solo
 * códigos y notificaciones) → nunca escribió.
 */
export const classifyByRules = (facts: ChatFacts): CategoryVerdict | null => {
  const s = facts.signals;
  const crm = crmVerdict(s);
  if (crm) return crm;

  const person = personMessages(facts.messages);
  const wrote = person.length > 0 || Boolean(facts.everWrote);

  if (s.hasWebinarRegistration || s.communityMember) {
    const where = s.hasWebinarRegistration ? "Se inscribió a un evento" : "Está en una comunidad";
    if (person.length === 0) {
      return facts.everWrote
        ? { category: "comunidad", confidence: 0.75, reason: where }
        : { category: "comunidad", confidence: 0.8, reason: `${where}; nunca escribió` };
    }
    const own = person.filter((m) => !isOwnAutomatic(m));
    if (own.length === 0) {
      return { category: "comunidad", confidence: 0.8, reason: `${where}; solo contestó su respuesta automática` };
    }
    if (own.every(isCourtesyMessage)) {
      return { category: "comunidad", confidence: 0.88, reason: `${where} y solo agradece o saluda` };
    }
    // Escribió algo más (una pregunta, «info», un audio): lo lee el modelo.
    return null;
  }

  if (person.length > 0) {
    // TODO lo que escribió tiene que ser código o notificación. Cualquier otra
    // cosa (un «hola», su propio contestador —es el negocio de una persona,
    // que puede estar interesada—) → el modelo.
    const hits = person.map((m) => negocioSignal(m.body));
    if (hits.every((h) => h?.kind === "otp" || h?.kind === "notification")) {
      return { category: "negocio", confidence: 0.95, reason: hits[0]!.reason };
    }
    return null;
  }

  if (!wrote) return { category: "otro", confidence: 0.7, reason: "Nunca escribió: solo le escribimos nosotros" };
  return null;
};

/**
 * Pistas para el modelo, en una línea cada una. El nombre de perfil solo va
 * si parece de una empresa (es un dato personal y no hace falta).
 */
export const signalHints = (facts: Pick<ChatFacts, "signals" | "participantName"> & { messages?: CategoryMessage[] }): string[] => {
  const s = facts.signals;
  const out: string[] = [];
  const brand = brandProfile(facts.participantName);
  if (brand) out.push(`El nombre de perfil de WhatsApp parece de una empresa (${brand}).`);
  if (s.hasWebinarRegistration) out.push("Se inscribió a un evento gratuito de Dayana (masterclass / clase en vivo).");
  if (s.communityMember) out.push("Está en (o fue invitada a) una comunidad de WhatsApp de Dayana.");
  if (s.inAddressBook) {
    out.push("Está guardada en la libreta del celular de Dayana (ahí guarda familia y amigos, pero también clientas).");
  }

  const person = personMessages(facts.messages ?? []);
  if (person.length > 0) {
    const kinds = person.map((m) => negocioSignal(m.body)?.kind).filter(Boolean);
    const count = (k: NegocioKind) => kinds.filter((x) => x === k).length;
    const of = (n: number) => `${n} de ${person.length} mensajes de la persona`;
    if (count("auto")) out.push(`${of(count("auto"))} parecen una respuesta automática de empresa (puede ser el contestador de su propio negocio).`);
    if (count("bot")) out.push(`${of(count("bot"))} parecen un menú de bot.`);
    if (count("spam")) out.push(`${of(count("spam"))} parecen publicidad.`);
    if (count("link")) out.push(`${of(count("link"))} son solo un enlace.`);
  }
  if (out.length === (brand ? 1 : 0)) out.push("No hay nada de esta persona en el CRM.");
  return out;
};
