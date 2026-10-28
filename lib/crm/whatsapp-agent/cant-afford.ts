import { foldForSearch } from "../search-normalize";
import { absoluteUrl, type AffordableOption } from "./community";
import { asksHowToPay, stateFromReply } from "./quote-follow-up-rules";
import type { OpenWorkshop } from "./workshop-interest";

/**
 * Dice que no le alcanza para iniciar (dueña, 28-oct: «quiero mejorar el
 * seguimiento: si la persona dice que no tiene plata para iniciar o cosas así,
 * quiero que el modelo le ofrezca cosas más gratuitas o más económicas, como
 * por ejemplo el taller si hay un taller activo»).
 *
 * Casos reales: al seguimiento del cierre Joselyn contestó «Ahorita no tengo
 * dinero y pues ayer fue el entierro de mi hermana» y Andrea «no le he dado
 * respuesta ya que no he tenido el dinero» / «por el factor económico aún no he
 * podido apartar la cita» (23 y 24-oct). La IA les dijo «cuando puedas, me
 * avisas» sin ofrecer nada: ni la comunidad gratis ni el curso, que estaban en
 * las reglas (el modelo no usó ninguna herramienta). Desde ese día también está
 * abierto el taller «Tu Sanación con el Dinero», más económico que el proceso.
 *
 * Así que a quien dice ahora que no le alcanza: lo más económico que hay en
 * este momento, en orden (el taller abierto con su enlace de pago, la comunidad
 * gratis, la opción económica de Ajustes: el curso en vivo), como mucho dos,
 * sin precios ni presión. Lo que no existe no se nombra.
 *
 * No es «no le alcanza»: el enlace que no abre («No puedo pagar» + «No me
 * deja», Lluvia, 26-oct), quien dice cuándo paga o que espera un dinero («a la
 * espera de la próxima semana recibir un dinero», Paola, 23-oct: va a pagar) ni
 * quien pide cómo pagar («no me alcanza para el de 6, mándame el de 3»).
 *
 * Puro: lo usan `brain.ts` (el prompt, las herramientas y el freno de la
 * respuesta) y el seguimiento del cierre (`quote-follow-up.ts`).
 */

/** Lo más económico que hay ahora, en el orden en que se ofrece. */
export type CheaperItem =
  /** El taller abierto: es pagado, pero más económico que el proceso. El valor lo ve en el enlace. */
  | { kind: "workshop"; title: string; when: string | null; url: string }
  /** La comunidad de WhatsApp de Dayana: gratis. */
  | { kind: "community"; url: string }
  /** La opción económica de Ajustes (el curso en vivo). */
  | { kind: "course"; key: string; name: string; url: string };

/** Como mucho dos: con tres enlaces el mensaje deja de ser corto. */
const MAX_ITEMS = 2;

/** El enlace no abre o el pago no pasa: eso es de Dayana, no de dinero. */
const TECH =
  /\bno (me )?(deja|abre|funciona|carga|sale|aparece|acepta|pasa)\b|\b(error|rechaz\w*|fallo|fallido|declinad\w*)\b|\b(el|la) (link|enlace|pagina|tarjeta|boton) no\b/;

/**
 * ¿Dice ahora que no le alcanza para iniciar? Lo decide `stateFromReply` (el
 * mismo «sin dinero» del seguimiento del cierre), sin el enlace que no abre y
 * sin quien pide cómo pagar.
 */
export const saysCantAfford = (texts: string[], opts: { at: Date; tz: string }): boolean => {
  const joined = texts.map((t) => t.replace(/^🎤\s*/, "").trim()).filter(Boolean).join("\n");
  if (!joined) return false;
  const t = foldForSearch(joined);
  if (TECH.test(t) || asksHowToPay(texts)) return false;
  return stateFromReply(joined, opts.at, opts.tz)?.state === "sin_dinero";
};

/** «domingo 15 de noviembre» en la zona del taller (o lo que diga su fecha escrita). */
const workshopDay = (w: OpenWorkshop): string | null => {
  if (w.startsAt) {
    return new Intl.DateTimeFormat("es-CO", { timeZone: w.timezone, weekday: "long", day: "numeric", month: "long" })
      .format(w.startsAt)
      .replace(",", "");
  }
  return w.dateLabel?.trim() || null;
};

/** «Curso en vivo con Dayana: clases en grupo…» → «curso en vivo con Dayana». */
const shortName = (label: string): string => {
  const name = label.split(/[:(]/)[0].trim() || label.trim();
  return name.charAt(0).toLowerCase() + name.slice(1);
};

/**
 * Lo más económico que hay ahora, en orden: el taller abierto (solo con su
 * enlace de pago y si no lo pagó: `workshop` ya llega así), la comunidad, la
 * primera opción económica de Ajustes. Como mucho dos.
 */
export const cheaperOptions = (input: {
  workshop: OpenWorkshop | null;
  community: string | null;
  options: AffordableOption[];
}): CheaperItem[] => {
  const items: CheaperItem[] = [];
  if (input.workshop?.payUrl) {
    items.push({ kind: "workshop", title: input.workshop.title, when: workshopDay(input.workshop), url: input.workshop.payUrl });
  }
  if (input.community) items.push({ kind: "community", url: input.community });
  const course = input.options[0];
  if (course) items.push({ kind: "course", key: course.key, name: shortName(course.label), url: absoluteUrl(course.url) });
  return items.slice(0, MAX_ITEMS);
};

/** La herramienta que manda el enlace de cada opción (para el prompt y el rastro). */
export const cheaperTool = (item: CheaperItem): string =>
  item.kind === "workshop" ? "send_workshop_link" : item.kind === "community" ? "send_community_link" : "send_affordable_option";

/**
 * La línea del prompt (solo cuando lo dice ahora: el prompt fijo no cambia).
 * `beforeCall`: todavía no tuvo su llamada gratis (se le puede ofrecer).
 */
export const cheaperLine = (items: CheaperItem[], opts: { beforeCall: boolean }): string => {
  const list = items
    .map((i) =>
      i.kind === "workshop"
        ? `el taller «${i.title}»${i.when ? `, el ${i.when}` : ""}: es pagado, pero más económico que el proceso; usa send_workshop_link (con el enlace separa su cupo; no digas el precio)`
        : i.kind === "community"
          ? "entrar gratis a la comunidad de Dayana en WhatsApp (send_community_link)"
          : `el ${i.name}, más económico que la terapia (send_affordable_option, option=${i.key})`
    )
    .join("; y ");
  return [
    "NO LE ALCANZA PARA INICIAR: dice que ahora no tiene cómo pagar o que no le alcanza. No escales, no insistas con el pago ni con su proceso y no hables de valores.",
    opts.beforeCall
      ? `Todavía no tuvo su llamada gratis con Dayana: recuérdale que esa llamada no tiene costo (si quiere hablar con Dayana o que la oriente, ofrécesela primero). Si no quiere la llamada, ofrécele lo más económico que hay ahora: ${list}.`
      : `En un solo mensaje corto y sin presionar: reconócelo con empatía en una frase (si contó algo difícil, eso primero) y ofrécele lo más económico que hay ahora: ${list}.`,
    "Solo eso: no inventes otras opciones ni precios. Deja la puerta abierta con «cuando puedas» (nunca «cuando estés lista» ni «listo»). Los enlaces los pega el sistema debajo de tu mensaje: no los escribas.",
  ].join(" ");
};

const WORKSHOP_NOTE = "(con el enlace separas tu cupo)";

/** Una opción dentro de la frase («el taller «…», el domingo 15 de noviembre (…)»). */
const phrase = (i: CheaperItem): string =>
  i.kind === "workshop"
    ? `el taller «${i.title}»${i.when ? `, el ${i.when}` : ""} ${WORKSHOP_NOTE}`
    : i.kind === "community"
      ? "la comunidad de Dayana en WhatsApp, que es gratis"
      : `el ${i.name}, en grupo y más económico que la terapia`;

/**
 * La frase con lo más económico («Mientras tanto, hay dos opciones más
 * económicas: … Te dejo los enlaces aquí abajo.»). `freeCall`: le recuerda que
 * la llamada gratis no tiene costo (todavía no la tuvo).
 */
export const cheaperSentence = (items: CheaperItem[], opts: { freeCall?: boolean } = {}): string => {
  const [a, b] = items;
  const offer = !a
    ? ""
    : b
      ? a.kind === "community"
        ? `Mientras tanto, puedes unirte gratis a la comunidad de Dayana en WhatsApp y, si quieres algo más económico, está ${phrase(b)}.`
        : `Mientras tanto, hay dos opciones más económicas: ${phrase(a)}, y ${phrase(b)}.`
      : a.kind === "community"
        ? "Mientras tanto, puedes unirte gratis a la comunidad de Dayana en WhatsApp."
        : `Mientras tanto, hay algo más económico: ${phrase(a)}.`;
  const call = opts.freeCall ? " Y la llamada con Dayana no tiene costo, por si quieres hablar con ella." : "";
  const links = items.length > 1 ? " Te dejo los enlaces aquí abajo." : items.length ? " Te dejo el enlace aquí abajo." : "";
  return `${offer}${call}${links}`.trim();
};

/**
 * Contó algo duro además de la plata (Joselyn: «ayer fue el entierro de mi
 * hermana»): la respuesta del código empieza por eso, no por «no te preocupes».
 */
const HARD_NEWS =
  /\b(muri\w*|fallec\w*|entierro|velorio|funeral|duelo|perdi a|perdio a|enferm\w*|hospital\w*|cirugia|accidente|cancer|me separe|divorci\w*|me quede sin (empleo|trabajo)|me echaron|me despidieron)\b/;
export const saysHardNews = (texts: string[]): boolean => HARD_NEWS.test(foldForSearch(texts.join(" ")));

/** La respuesta entera del código (el modelo escaló o solo dijo que lo consultaba). */
export const cheaperReply = (items: CheaperItem[], opts: { name: string | null; beforeCall: boolean; hard?: boolean }): string => {
  const who = opts.name ? `, ${opts.name}` : "";
  const hi = opts.hard ? `Siento mucho lo que estás pasando${who} 🙏` : `Te entiendo${who}, no te preocupes 🙏`;
  const wait = opts.beforeCall ? "" : " Cuando puedas iniciar tu proceso, Dayana queda atenta.";
  return `${hi}${wait} ${cheaperSentence(items, { freeCall: opts.beforeCall })}`;
};

/**
 * «Cuando estés lista» a quien no dijo su género (eval 28-oct: el modelo lo
 * escribe al dejarle la puerta abierta; también «cuando tengas el momento y
 * estés lista»): «puedas», que vale para todos.
 */
export const withoutReadyGender = (text: string): string =>
  text
    .replace(/\b(te sientas|estés|estes) (list[ao]s?|preparad[ao]s?)\b/gi, (m) => (/^[A-ZÉ]/.test(m) ? "Puedas" : "puedas"))
    // «Cuando puedas y estés lista» → «cuando puedas y puedas»: una sola vez.
    .replace(/\b(puedas),? y puedas( hacerlo)?\b/gi, "$1")
    // «Te entiendo de corazón» (Joselyn, 24-oct, también en producción): sin el «corazón» (tono serio).
    .replace(/\s+(de|con el|con todo el|con todo mi) coraz[oó]n\b/gi, "");

/** ¿La respuesta ya le ofrece la llamada gratis («te agendo una llamada gratis…»)? */
export const invitesFreeCall = (text: string): boolean => {
  const t = foldForSearch(text);
  return /\bllamada\b/.test(t) && /\b(gratis|gratuita|sin costo|no tiene costo|no tiene ningun costo|sin ningun costo)\b/.test(t);
};

/**
 * ¿Pide hablar con Dayana o que la orienten? (Divianys, 24-oct: «me gustaría
 * mucho hablar con ella… que me guiara»): antes de la llamada, la llamada gratis
 * es la respuesta. SF («primero ahorraré y luego me inscribiré») no lo pide.
 */
export const wantsToTalk = (texts: string[]): boolean =>
  /\b(hablar|conversar|llamada|llamar|llamen|guia\w*|guie\w*|orient\w*|ayuda\w*|ayude\w*|asesor\w*|escuch\w*)\b/.test(foldForSearch(texts.join(" ")));

/** ¿La respuesta nombra el taller? (si lo ofreció sin la herramienta, el código pega el enlace). */
export const mentionsWorkshop = (text: string): boolean => /\b(taller|talleres)\b/.test(foldForSearch(text));

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
/** El tope de la evaluación es 90 palabras: con lo que agrega el código, que quede debajo. */
const MAX_WORDS = 85;

/**
 * Lo que sale cuando dice que no le alcanza (el freno de `replyText`):
 * - `replace` (el modelo escaló, solo dijo que lo consultaba o le mandó cómo
 *   pagar su proceso) o sin texto: la respuesta del código con todo.
 * - Ya va lo primero de la lista (el modelo usó la herramienta): tal cual.
 * - Antes de la llamada, si pidió hablar con Dayana u orientación (`talk`) y la
 *   respuesta le ofrece la llamada gratis (Divianys, 24-oct: «la llamada con
 *   Dayana es completamente gratis»): tal cual; esa es la opción.
 * - Si no ofrece nada: su texto y debajo la frase con lo más económico; si ya
 *   ofreció otra cosa (la comunidad), solo lo que falta de primero (el taller).
 *   Antes de la llamada, también que la llamada no tiene costo (si no lo dice).
 *   Antes de la pregunta del final, si termina en una. Si queda larga, la del código.
 * `attached`: los enlaces que ya van debajo. Devuelve los que hay que pegar.
 */
export const withCheaper = (
  text: string,
  items: CheaperItem[],
  opts: { attached: string[]; replace: boolean; beforeCall: boolean; name: string | null; hard?: boolean; talk?: boolean }
): { text: string; links: string[]; replaced: boolean } => {
  if (items.length === 0) return { text, links: [], replaced: false };
  const whole = () => ({ text: cheaperReply(items, opts), links: items.map((i) => i.url), replaced: true });
  if (opts.replace || !text.trim()) return whole();
  text = withoutReadyGender(text);
  // Nombró el taller sin la herramienta: el enlace lo pega el código.
  const typed = items.filter((i) => i.kind === "workshop" && mentionsWorkshop(text) && !opts.attached.includes(i.url)).map((i) => i.url);
  const offered = items.filter((i) => opts.attached.includes(i.url) || typed.includes(i.url));
  if (offered.includes(items[0])) return { text, links: typed, replaced: false };
  if (opts.beforeCall && opts.talk && offered.length === 0 && invitesFreeCall(text)) return { text, links: [], replaced: false };
  const missing = offered.length ? [items[0]] : items;
  const freeCall = opts.beforeCall && !invitesFreeCall(text);
  const sentence =
    offered.length > 0
      ? `${
          missing[0].kind === "community" ? "También puedes unirte gratis a la comunidad de Dayana en WhatsApp." : `También está ${phrase(missing[0])}.`
        }${freeCall ? " Y la llamada con Dayana no tiene costo, por si quieres hablar con ella." : ""}`
      : cheaperSentence(missing, { freeCall });
  if (wordCount(text) + wordCount(sentence) > MAX_WORDS) return whole();
  const body = text.trim();
  const q = body.lastIndexOf("¿");
  const tailQ = q > 0 && body.endsWith("?") && !body.slice(q).includes("\n");
  const out = tailQ ? `${body.slice(0, q).trimEnd()}\n\n${sentence}\n\n${body.slice(q)}` : `${body}\n\n${sentence}`;
  return { text: out, links: [...typed, ...missing.map((i) => i.url)], replaced: false };
};

// --- El seguimiento del cierre a quien dijo que no le alcanza ---------------

/** Lo que cabe en la variable de la plantilla `retomar_conversacion` (`MENSAJE_MAX`). */
const TEMPLATE_MAX = 300;

/**
 * El seguimiento a quien dijo que no le alcanza (dentro de las 24 h): en vez de
 * «¿Cuándo te gustaría empezar?», lo más económico que hay ahora, con los
 * enlaces debajo (como los pega el código en una respuesta).
 */
export const cheaperFollowUpText = (name: string | null, items: CheaperItem[]): string => {
  const hola = name ? `Hola ${name}, te bendigo 🙏` : "Hola, te bendigo 🙏";
  return [
    `${hola} ¿Cómo has estado? Dayana queda atenta para cuando puedas iniciar tu proceso. ${cheaperSentence(items)}`,
    ...items.map((i) => i.url),
  ].join("\n\n");
};

/**
 * Fuera de las 24 h va en la plantilla aprobada `retomar_conversacion` («Hola
 * {{nombre}}, te bendigo 💛 Te escribo para retomar nuestra conversación.
 * {{mensaje}} Quedo atenta a tu respuesta por aquí.»): una sola línea de hasta
 * 300 caracteres, con los enlaces dentro (sin saltos: WhatsApp no los acepta en
 * una variable). Si no cabe: sin la fecha, con el comienzo corto, luego solo lo
 * primero, luego el título más corto. Un enlace nunca se corta.
 */
export const cheaperTemplateMessage = (items: CheaperItem[]): string => {
  const one = (i: CheaperItem, withDay: boolean, title = i.kind === "workshop" ? i.title : "") =>
    i.kind === "workshop"
      ? `el taller «${title}»${withDay && i.when ? ` del ${i.when}` : ""}, para separar tu cupo: ${i.url}`
      : i.kind === "community"
        ? `la comunidad gratis de Dayana: ${i.url}`
        : `el ${i.name}, más económico que la terapia: ${i.url}`;
  const build = (list: CheaperItem[], withDay: boolean, short = false, title?: string) => {
    const parts = list.map((i) => one(i, withDay, title));
    const offer = parts.length > 1 ? `hay opciones más económicas: ${parts[0]} y ${parts[1]}` : `hay algo más económico: ${parts[0]}`;
    return short
      ? `Mientras llega el momento de iniciar tu proceso, ${offer}`
      : `Dayana queda atenta para cuando puedas iniciar tu proceso. Mientras tanto, ${offer}`;
  };
  if (items.length === 0) return "Dayana queda atenta para cuando puedas iniciar tu proceso.";
  const first = items.slice(0, 1);
  const options = [
    build(items, true),
    build(items, false),
    build(items, true, true),
    build(items, false, true),
    build(first, true),
    build(first, false),
    build(first, false, true),
  ];
  const fits = options.find((m) => m.length <= TEMPLATE_MAX);
  if (fits) return fits;
  // Un título larguísimo: se acorta el título, nunca el enlace.
  const top = items[0];
  if (top.kind !== "workshop") return build(first, false, true);
  const room = Math.max(TEMPLATE_MAX - build(first, false, true, "").length - 1, 0);
  return build(first, false, true, `${top.title.slice(0, room).trimEnd()}…`);
};
