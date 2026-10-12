import { foldForSearch } from "./search-normalize";

/**
 * Antes de importar un chat exportado del celular: ¿es de trabajo o personal?
 *
 * El celular de Dayana tiene sus chats de clientes mezclados con los de su
 * familia y amigos. Los personales no se suben al CRM (ni un mensaje): solo se
 * importa lo que es de trabajo. Ante la duda, NO se decide aquí: queda para
 * que Dayana lo mire («revisar»), o para la IA si está disponible.
 *
 * Puro (sin base de datos ni modelo): lo usan el servidor y las pruebas.
 */

export type ExportVerdict = "business" | "personal" | "team" | "group" | "empty" | "unknown";

export type ExportClassification = {
  verdict: ExportVerdict;
  confidence: number;
  /** Por qué, en palabras de Dayana (sin citar mensajes). */
  reasons: string[];
};

export type ExportClassifyInput = {
  authors: string[];
  dayanaAuthor: string | null;
  messages: { author: string; body: string | null }[];
  /** Lo que el CRM ya sabe de ese número. */
  crm?: {
    isTeam?: boolean;
    hasPayment?: boolean;
    hasEnrollment?: boolean;
    hasDiagnostic?: boolean;
    hasWebinar?: boolean;
    hasAppointment?: boolean;
  };
};

/** Palabras del trabajo de Dayana (terapia, citas, pagos, eventos). */
const BUSINESS_TERMS: [string, RegExp][] = [
  ["sesiones", /\bsesi(o|ó)n(es)?\b/],
  ["terapia", /\bterapia|\bterapeut/],
  ["proceso", /\b(tu|el|mi|del) proceso\b/],
  ["llamada gratis", /\bllamada (gratis|gratuita)|\bconsulta (gratis|gratuita)|\bvaloraci(o|ó)n\b/],
  ["agendar", /\bagend(ar|amos|o|a|é)\b|\bcita\b/],
  ["paquete", /\bpaquete\b/],
  ["taller o evento", /\btaller|\bmasterclass|\bwebinar|\bclase en vivo|\bevento gratuito/],
  ["PNL", /\bpnl\b|\breprogram|\bni(n|ñ)o interior|\bsanaci(o|ó)n|\bsanar\b|\bliberar (la|esa|tu)/],
  ["precio", /\bcu(a|á)nto (cuesta|vale|es)|\bprecio|\bvalor de/],
  ["pago", /\bcomprobante|\btransfer(i|encia)|\bconsign(e|é|aci)|\bnequi\b|\bdaviplata\b|\bbancolombia\b|\bpaypal\b|\bpago\b/],
  ["el sitio de Dayana", /dayanabeltran\.com|\/pagar\//],
];

/** Trato de familia o amigos, sobre todo en lo que escribe Dayana. */
const PERSONAL_TERMS: [string, RegExp][] = [
  ["familia", /\b(mami|mamita|mamá|mama|papi|papá|hija|hijo|hijita|hermanit[ao]|herman[ao]|t(i|í)[ao]|prim[ao]|abuel[ao]|suegr[ao]|cuñad[ao]|sobrin[ao]|nieta|nieto)\b/],
  ["te amo", /\bte amo\b|\bte extraño\b/],
  ["planes de casa", /\balmuerzo\b|\bcena(mos)?\b|\bmercado\b|\bla casa\b|\brecoger a\b|\bel colegio\b|\bvienes el\b/],
  ["celebraciones", /\bfeliz cumple|\bcumpleaños\b|\bnavidad en\b|\bla fiesta\b/],
];

const hits = (terms: [string, RegExp][], texts: string[]): string[] =>
  terms.filter(([, re]) => texts.some((t) => re.test(t))).map(([label]) => label);

export const classifyExportRules = (input: ExportClassifyInput): ExportClassification => {
  if (input.authors.length > 2) return { verdict: "group", confidence: 1, reasons: ["Es un chat de grupo."] };
  const withText = input.messages.filter((m) => m.body?.trim());
  if (withText.length < 2) return { verdict: "empty", confidence: 0.9, reasons: ["Casi no tiene mensajes."] };
  if (input.crm?.isTeam) return { verdict: "team", confidence: 1, reasons: ["Es un número del equipo."] };

  const crm = input.crm ?? {};
  const crmReasons = [
    crm.hasPayment && "pagó en el CRM",
    crm.hasEnrollment && "tiene una inscripción",
    crm.hasAppointment && "tiene citas en el calendario",
    crm.hasDiagnostic && "hizo la autoevaluación",
    crm.hasWebinar && "se inscribió a un evento",
  ].filter((r): r is string => Boolean(r));
  if (crmReasons.length) {
    return { verdict: "business", confidence: 0.95, reasons: [`En el CRM: ${crmReasons.join(", ")}.`] };
  }

  const folded = withText.map((m) => foldForSearch(m.body!));
  const dayana = input.dayanaAuthor
    ? withText.filter((m) => m.author === input.dayanaAuthor).map((m) => foldForSearch(m.body!))
    : [];
  const business = hits(BUSINESS_TERMS, folded);
  // Lo personal pesa en lo que escribe Dayana: una clienta puede decir «mi
  // mamá»; Dayana a una clienta no le dice «mami».
  const personal = hits(PERSONAL_TERMS, dayana.length ? dayana : folded);

  if (business.length >= 3 && personal.length <= 1) {
    return { verdict: "business", confidence: 0.85, reasons: [`Habla de ${business.slice(0, 3).join(", ")}.`] };
  }
  if (business.length >= 2 && personal.length === 0) {
    return { verdict: "business", confidence: 0.8, reasons: [`Habla de ${business.join(", ")}.`] };
  }
  if (personal.length >= 2 && business.length === 0) {
    return { verdict: "personal", confidence: 0.92, reasons: [`Trato personal: ${personal.join(", ")}.`] };
  }
  if (personal.length >= 1 && business.length === 0) {
    return { verdict: "personal", confidence: 0.75, reasons: [`Trato personal: ${personal.join(", ")}.`] };
  }
  return {
    verdict: "unknown",
    confidence: 0.5,
    reasons: business.length || personal.length ? [`Señales mezcladas (${[...business, ...personal].join(", ")}).`] : ["Sin señales claras."],
  };
};

/** Qué se hace con el chat según lo que se sabe de él. */
export type ExportDecision = "import" | "skip" | "review";

/**
 * Trabajo seguro se importa; personal muy seguro, grupo, equipo o vacío se
 * salta; lo demás lo decide Dayana. Nunca se importa algo dudoso por defecto:
 * un chat personal en el CRM no se puede «des-subir» sin que alguien lo vea.
 */
export const decideExport = (c: ExportClassification): ExportDecision => {
  if (c.verdict === "business" && c.confidence >= 0.8) return "import";
  if (c.verdict === "group" || c.verdict === "team" || c.verdict === "empty") return "skip";
  if (c.verdict === "personal" && c.confidence >= 0.9) return "skip";
  return "review";
};

/**
 * Quién es Dayana en una tanda de chats: todos salen de su celular, así que
 * su nombre aparece en (casi) todos los chats de dos personas. Hace falta al
 * menos 3 chats y que esté en el 60 % o más; si no, null.
 */
export const detectBatchOwner = (authorLists: string[][]): string | null => {
  const pairs = authorLists.filter((a) => a.length === 2);
  if (pairs.length < 3) return null;
  const counts = new Map<string, { count: number; spelling: string }>();
  for (const authors of pairs) {
    for (const name of new Set(authors.map((a) => a.trim()))) {
      const key = foldForSearch(name);
      const prev = counts.get(key);
      counts.set(key, { count: (prev?.count ?? 0) + 1, spelling: prev?.spelling ?? name });
    }
  }
  const [best] = [...counts.values()].sort((a, b) => b.count - a.count);
  return best && best.count / pairs.length >= 0.6 ? best.spelling : null;
};
