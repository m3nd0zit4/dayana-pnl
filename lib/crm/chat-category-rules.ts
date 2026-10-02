/**
 * Clasificación de los chats de WhatsApp, en reglas puras (sin base de datos
 * ni modelo): las usan el servidor, el script de vista previa y las pruebas.
 *
 * Primero lo que dice el CRM (pagó, agendó, hizo la autoevaluación, se
 * inscribió a un evento), luego patrones inequívocos en lo que ESCRIBIÓ la
 * persona (códigos de verificación, respuestas automáticas, bots, spam). Lo que
 * no queda claro devuelve `null` y lo decide el modelo (chat-category-ai.ts).
 *
 * Un chat donde la persona nunca escribió solo se clasifica por el CRM: si no
 * hay nada, es `otro` con confianza baja (solo le escribimos nosotros).
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

/** Por debajo de esto, lo que dijo la IA se marca «revisar». */
export const REVIEW_BELOW = 0.7;

/** Categorías a las que la IA no debe contestar ni cuentan en «Te toca» (fase B2). */
export const SILENT_CATEGORIES: readonly ChatCategory[] = ["personal", "negocio", "equipo"];

export type CategorySignals = {
  /** El número está en Ajustes → equipo (`whatsapp.team_phones`). */
  isTeamPhone?: boolean;
  /** Matrícula ACTIVE/COMPLETED con importe (no gratis). */
  hasPaidEnrollment?: boolean;
  /** Tipo de lo que pagó, para el motivo. */
  paidKind?: string | null;
  hasApprovedPayment?: boolean;
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
  /** Está en la libreta del celular (sincronización de coexistencia). */
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
  /** Del más nuevo al más viejo o al revés: el orden no importa a las reglas. */
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

/** «+57 300 123 4567» → «+573001234567»; `null` si no parece un número. */
export const normalizeTeamPhone = (raw: string): string | null => {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
};

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

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|co|net|org|io|ly|me|app|shop|store|link|site|online|xyz|info|mx|ar|pe|cl|ec|es)(?:\/\S*)?/gi;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}‍️⃣]/gu;

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

// ── Cortesía: gracias, saludos, bendiciones, emojis ──────────────────────

const COURTESY_WORDS = new Set(
  `gracias gracia muchas muchisimas mil infinitas por todo toda tu su sus la las el los lo le les un una unos
  informacion info invitacion compartir recordatorio recordarme link enlace mensaje mensajes clase clases masterclass
  taller evento espacio regalo ensenanza ensenanzas palabras video tiempo charla encuentro sesion conferencia
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
 * Cualquier palabra fuera del vocabulario de cortesía —«precio», «terapia»,
 * «quiero»— lo deja fuera: eso lo lee el modelo.
 */
export const isCourtesyMessage = (m: CategoryMessage): boolean => {
  const kinds = attachmentKinds(m.attachments);
  if (kinds.some((k) => k !== "sticker")) return false;
  const text = normalizeText(m.body ?? "").replace(EMOJI_RE, " ");
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return true;
  if (words.length > 15) return false;
  return words.every(courtesyWord);
};

// ── Negocio: códigos, respuestas automáticas, bots, marcas, spam ─────────

export type NegocioKind = "otp" | "auto" | "bot" | "brand" | "spam" | "link";

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
/** Como nombre de perfil son apodos o apellidos: solo cuentan por el mensaje. */
const AMBIGUOUS_PROFILE_BRANDS = new Set(["didi", "claro", "wom", "exito", "envia", "personal flow", "uber"]);

const alternation = (list: string[]) => list.map((b) => b.replace(/\s+/g, "\\s+")).join("|");
/**
 * «Bancolombia: …», «[Rappi] Tu pedido…», «Claro te informa…». Al principio
 * del mensaje no cuentan las marcas que también son palabras («Claro: ahí
 * estaré», «Éxito - …»): esas solo con «te informa».
 */
const BRAND_SENDER_RE = new RegExp(
  `^\\W*\\[?(${alternation(BRANDS.filter((b) => !AMBIGUOUS_PROFILE_BRANDS.has(b)))})\\]?\\s*(?::|-|\\||\\])|\\b(${alternation(BRANDS)})\\s+(?:te|le)\\s+(?:informa|recuerda|notifica|avisa)\\b`
);

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
    String.raw`\b(?:tu|su|el)\s+codigo(?:\s+de\s+(?:verificacion|seguridad|acceso|confirmacion|activacion|whatsapp|ingreso)(?:\s+de\s+\w+)?)?\s*(?:es|:)\s*:?\s*${CODE}\b`
  ),
  new RegExp(String.raw`\b${CODE}\b\s*(?:es|is)\s+(?:tu|su|your)\s+(?:codigo|code)\b`),
  /\bno\s+(?:compartas|comparta|compartir)\s+(?:este|el|tu|su|esta)\s+(?:codigo|clave)/,
  /\bnunca\s+(?:compartas|comparta)\s+(?:este|tu|su)\s+(?:codigo|clave)/,
  /\bdo\s+not\s+share\s+(?:this|your)\s+code\b/,
];
const OTP_PHRASE = /\bcodigo\s+de\s+(?:seguridad|verificacion|acceso|confirmacion|activacion)\b|\b(?:verification|security|login)\s+code\b|\byour\s+code\b/;

const AUTO_RES: RegExp[] = [
  /\bgracias\s+por\s+(?:comunicarte|comunicarse)\s+(?:con|a)\b/,
  /\bgracias\s+por\s+(?:contactarnos|escribirnos|preferirnos|elegirnos)\b/,
  /\ben\s+breve\s+(?:te|le|lo|la|nos)?\s*(?:atenderemos|responderemos|contestaremos|contactaremos|comunicaremos|atendera|respondera|pondremos)\b/,
  /\b(?:te|le)\s+(?:responderemos|atenderemos|contactaremos|contestaremos)\s+(?:lo\s+antes\s+posible|lo\s+mas\s+pronto|a\s+la\s+brevedad|en\s+breve|pronto|en\s+un\s+momento)/,
  /\bnuestro\s+horario\s+de\s+atencion\b|\bhorario\s+de\s+atencion\s*(?:es\b|:|de\s+lunes|lunes)|\bfuera\s+de(?:l)?\s+(?:nuestro\s+)?horario\s+de\s+atencion/,
  /\bno\s+(?:responda|respondas|responder)\s+(?:a\s+)?este\s+(?:mensaje|numero|chat|correo)/,
  /\beste\s+numero\s+no\s+(?:recibe|acepta|responde|atiende)\b/,
  // «¿Cómo podemos ayudar a mi hija?» lo pregunta una madre: solo «en qué (te) podemos ayudar».
  /\ben\s+que\s+(?:te\s+|le\s+)?podemos\s+(?:ayudarte|ayudarle|ayudar|servirte|servirle|colaborarte)\b/,
  /\bestamos\s+(?:ausentes|fuera\s+de\s+(?:la\s+)?oficina)\b|\ben\s+este\s+momento\s+no\s+(?:estamos\s+disponibles|podemos\s+atender(?:te|le)?)\b/,
  /\bbienvenid[oa]s?\s+a\s+(?:nuestr[oa]|la\s+linea\s+de|el\s+canal\s+de)\b/,
];
/** «Este es un mensaje automático» — pero «¿esto es un mensaje automático?» lo pregunta una persona. */
const AUTO_MESSAGE_RE = /\b(?:este\s+es\s+un|es\s+un|esta\s+es\s+una)\s+(?:mensaje|respuesta)\s+(?:generad[oa]\s+)?automatic[oa]\b/;

const BOT_RES: RegExp[] = [
  /\b(?:selecciona|elige|escoge|digita|marca|escribe|responde\s+con)\s+(?:una\s+|la\s+|el\s+numero\s+de\s+la\s+|el\s+numero\s+de\s+tu\s+)?opcion\b/,
  /\bmenu\s+(?:principal|de\s+opciones)\b/,
  /\bver\s+(?:nuestro\s+|el\s+)?catalogo\b|\bnuestro\s+catalogo\b/,
  /\b(?:tu|su)\s+(?:pedido|orden|compra|envio)\s+(?:ha\s+sido|fue|esta|se\s+encuentra|va\s+en\s+camino|llego|#|numero|no\.)/,
  /\bnumero\s+de\s+(?:pedido|orden|guia|seguimiento|rastreo)\b/,
  /\b(?:haz|realiza|haga|realice)\s+(?:tu|su)\s+pedido\b/,
];

const SPAM_RES: RegExp[] = [
  /\bgana(?:r)?\s+(?:dinero|plata|\$|desde\s+(?:casa|tu\s+celular))/,
  /\b(?:genera|generar|recibe|recibir)\s+ingresos\b|\bingresos\s+(?:extra|pasivos|diarios)\b/,
  /\bbono\s+(?:de\s+bienvenida|en\s+tu\s+primer\s+deposito)\b|\bprimer\s+deposito\b/,
  /\bcopy\s*trading\b|\btrading\b|\bforex\b|\bcriptomonedas?\b|\bbitcoin\b|\bbinance\b|\busdt\b/,
  /\binversion\s+(?:minima|segura|garantizada)\b|\brentabilidad\s+(?:diaria|garantizada)\b|\bganancias?\s+(?:diarias|garantizadas|aseguradas)\b/,
  /\boferta\s+de\s+(?:empleo|trabajo)\b|\btrabaja\s+desde\s+(?:casa|tu\s+celular)\b/,
  /\b(?:responde|envia|escribe)\s+(?:baja|stop|salir)\b|\bpara\s+(?:dejar\s+de\s+recibir|no\s+recibir\s+mas)\b|\bdarte\s+de\s+baja\b/,
  /\bfelicidades,?\s+(?:has\s+sido|fuiste)\s+(?:seleccionad|el\s+ganador|la\s+ganadora)|\bhas\s+ganado\b|\breclama\s+tu\s+premio\b/,
];

/**
 * Ofertas y descuentos: cuentan solo como afirmación. «¿Tienes alguna oferta
 * especial?» o «¿me das 10% de descuento?» lo pregunta una interesada.
 */
const PROMO_RES: RegExp[] = [
  /\b(?:descuento|oferta|promocion|promo)\s+(?:exclusiva|especial|valida|por\s+tiempo\s+limitado|imperdible)\b/,
  /\baprovecha\s+(?:esta|nuestra|nuestras|nuestros)\s+(?:oferta|promo|descuento)|\bultimas\s+unidades\b/,
  /\b(?:hasta|obten|aprovecha|con)\s+(?:un\s+|el\s+)?\d{1,2}\s?%\s+(?:de\s+)?(?:descuento|off|dcto)\b/,
];

/** Enlaces que comparte una persona (un reel, una ubicación, la web de Dayana, un pago). */
const PERSONAL_LINK_RE =
  /instagram|tiktok|youtu|facebook|fb\.watch|x\.com|twitter|spotify|maps|goo\.gl|wa\.me|dayanabeltran|meet\.google|zoom\.us|drive\.google|docs\.google|pin\.it|pinterest|threads|mpago|mercadopago|paypal|nequi|bancolombia|daviplata/;

/** ¿Por qué este mensaje parece de una empresa? `null` si parece de una persona. */
export const negocioSignal = (body: string | null | undefined): { kind: NegocioKind; reason: string } | null => {
  const raw = body?.trim();
  if (!raw) return null;
  const t = normalizeText(raw);

  if (OTP_RES.some((r) => r.test(t)) || (OTP_PHRASE.test(t) && DIGITS_CODE.test(t))) {
    return { kind: "otp", reason: "Código de verificación" };
  }
  const brand = t.match(BRAND_SENDER_RE);
  if (brand) return { kind: "brand", reason: `Notificación de ${brandLabel(brand[1] ?? brand[2])}` };
  if (SPAM_RES.some((r) => r.test(t)) || (!/[?¿]/.test(raw) && PROMO_RES.some((r) => r.test(t)))) {
    return { kind: "spam", reason: "Publicidad o spam" };
  }
  if (BOT_RES.some((r) => r.test(t))) return { kind: "bot", reason: "Menú o pedidos de un bot" };
  if (AUTO_RES.some((r) => r.test(t)) || (AUTO_MESSAGE_RE.test(t) && !/[?¿]/.test(raw))) {
    return { kind: "auto", reason: "Respuesta automática de una empresa" };
  }

  const urls = raw.match(URL_RE) ?? [];
  if (urls.length > 0) {
    const rest = normalizeText(raw.replace(URL_RE, " ")).replace(EMOJI_RE, " ");
    const words = rest.split(/[^a-z0-9]+/).filter(Boolean);
    const personal = urls.some((u) => PERSONAL_LINK_RE.test(u.toLowerCase()));
    if (words.length <= 6 && !personal) return { kind: "link", reason: "Solo envía enlaces de publicidad" };
  }
  return null;
};

/** Nombre de perfil que es una marca («Bancolombia», «Rappi Colombia»). */
export const brandProfile = (name: string | null | undefined): string | null => {
  const t = normalizeText(name?.trim() ?? "").replace(EMOJI_RE, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const b of BRANDS) {
    if (AMBIGUOUS_PROFILE_BRANDS.has(b)) continue;
    if (t === b || t.startsWith(`${b} `)) return brandLabel(b);
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
 * La categoría por reglas, o `null` si no está claro (lo decide el modelo).
 *
 * Orden: equipo → cliente → interés del CRM → comunidad → negocio →
 * libreta → nunca escribió. Las señales del CRM van antes que los patrones de
 * negocio porque quien se inscribió a algo es una persona, aunque su propio
 * WhatsApp Business conteste solo («gracias por comunicarte con…»).
 */
export const classifyByRules = (facts: ChatFacts): CategoryVerdict | null => {
  const s = facts.signals;

  if (s.isTeamPhone) return { category: "equipo", confidence: 1, reason: "Número del equipo" };

  if (s.hasPaidEnrollment) {
    return { category: "cliente", confidence: 0.98, reason: PAID_REASON[s.paidKind ?? ""] ?? "Pagó un paquete" };
  }
  if (s.hasApprovedPayment) return { category: "cliente", confidence: 0.97, reason: "Tiene un pago aprobado" };
  if (s.hasTherapySession) {
    return { category: "cliente", confidence: 0.9, reason: "Tiene sesiones de terapia en el calendario" };
  }

  if (s.hasBooking) return { category: "interesada", confidence: 0.92, reason: "Agendó la llamada gratis" };
  if (s.hasDiagnostic) return { category: "interesada", confidence: 0.9, reason: "Hizo la autoevaluación" };
  if (s.hasPendingPayment) return { category: "interesada", confidence: 0.88, reason: "Empezó a pagar y no terminó" };
  if (s.hasLeadEnrollment) return { category: "interesada", confidence: 0.85, reason: "Pidió información de un servicio" };

  const person = personMessages(facts.messages);
  const wrote = person.length > 0 || Boolean(facts.everWrote);
  const event = Boolean(s.hasWebinarRegistration || s.communityMember);

  if (event) {
    const where = s.hasWebinarRegistration ? "Se inscribió a un evento" : "Está en una comunidad";
    if (person.length === 0) {
      return facts.everWrote
        ? { category: "comunidad", confidence: 0.75, reason: where }
        : { category: "comunidad", confidence: 0.8, reason: `${where}; nunca escribió` };
    }
    // Su propio contestador automático no cuenta como algo que escribió.
    const own = person.filter((m) => !negocioSignal(m.body));
    if (own.length === 0) {
      return { category: "comunidad", confidence: 0.8, reason: `${where}; solo contestó su respuesta automática` };
    }
    if (own.every(isCourtesyMessage)) {
      return { category: "comunidad", confidence: 0.88, reason: `${where} y solo agradece o saluda` };
    }
    // Escribió algo más (una pregunta, un audio): lo lee el modelo.
    return null;
  }

  const brand = brandProfile(facts.participantName);
  if (brand) return { category: "negocio", confidence: 0.9, reason: `Perfil de empresa: ${brand}` };

  if (person.length > 0) {
    const hits = person.map((m) => negocioSignal(m.body)).filter((h): h is NonNullable<typeof h> => h !== null);
    const strong = hits.filter((h) => h.kind !== "link");
    // Más de la mitad de lo que escribió parece de empresa: no es una persona
    // que un día reenvió un código o tiene contestador.
    if (strong.length > 0 && hits.length * 2 >= person.length) {
      return { category: "negocio", confidence: 0.95, reason: strong[0].reason };
    }
    if (hits.length === person.length) {
      return { category: "negocio", confidence: 0.75, reason: hits[0].reason };
    }
  }

  if (s.inAddressBook) return { category: "personal", confidence: 0.85, reason: "Está en la libreta del celular" };

  if (!wrote) return { category: "otro", confidence: 0.3, reason: "Nunca escribió: solo le escribimos nosotros" };

  return null;
};

/** Pistas del CRM para el modelo, en una línea cada una. */
export const signalHints = (facts: Pick<ChatFacts, "signals" | "participantName">): string[] => {
  const s = facts.signals;
  const out: string[] = [];
  if (facts.participantName?.trim()) out.push(`Nombre de perfil de WhatsApp: «${facts.participantName.trim().slice(0, 60)}».`);
  if (s.hasWebinarRegistration) out.push("Se inscribió a un evento gratuito de Dayana (masterclass / clase en vivo).");
  if (s.communityMember) out.push("Está en (o fue invitada a) una comunidad de WhatsApp de Dayana.");
  if (s.inAddressBook) out.push("Está guardada en la libreta de contactos del celular de Dayana.");
  if (s.hasLeadEnrollment) out.push("En el CRM pidió información de un servicio.");
  if (s.hasPendingPayment) out.push("En el CRM empezó un pago y no lo terminó.");
  if (s.hasDiagnostic) out.push("Hizo la autoevaluación de la web.");
  if (s.hasBooking) out.push("Tiene agendada la llamada gratis.");
  if (out.length === (facts.participantName?.trim() ? 1 : 0)) out.push("No hay nada de esta persona en el CRM.");
  return out;
};
