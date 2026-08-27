import type { DiagnosticProfileId } from "./scoring";

/**
 * El copy de la página de resultado, por perfil.
 *
 * Esta es la parte que sustituye a la llamada de ventas, así que sigue su
 * misma secuencia: nombrar el patrón → explicarlo → cerrar la objeción de "ya
 * intenté y no funcionó" → mostrar el método → una sola oferta → quitar el
 * riesgo. Cambiar el orden de los bloques en la página cambia la conversión;
 * cambiar estas palabras, no tanto. Por eso el orden vive en el componente y
 * las palabras viven aquí.
 */

export type DiagnosticProfileCopy = {
  /** Nombre del perfil tal y como lo lee la persona. Nunca el enum. */
  name: string;
  /** Una línea que resume su momento. Va bajo el nombre. */
  tagline: string;
  /** El espejo: lo que está pasando, dicho sin suavizarlo. */
  mirror: string;
  /** Por qué lo que ya intentó no funcionó. Cierra la objeción antes de que aparezca. */
  whyItFailed: string;
  /** Encuadre de la oferta. Va justo encima del precio. */
  offerFraming: string;
  /** Qué pasa si no encaja. Reversión de riesgo, en su sitio: junto al botón. */
  riskReversal: string;
  /** Texto del CTA principal. */
  ctaLabel: string;
  /** Mensaje precargado de WhatsApp para la salida secundaria. */
  whatsappIntro: string;
};

export const DIAGNOSTIC_PROFILES: Record<
  DiagnosticProfileId,
  DiagnosticProfileCopy
> = {
  EXPLORADOR: {
    name: "Estás mirando desde la orilla",
    tagline: "Sabes que algo tiene que cambiar. Todavía no decides cuándo.",
    mirror:
      "No estás en crisis, y por eso es fácil dejarlo para después. El problema es que los patrones no se quedan quietos mientras esperas: se hacen costumbre. Lo que hoy te incomoda un poco, en un año te va a parecer tu forma de ser.",
    whyItFailed:
      "Leer sobre esto, escuchar sobre esto y entenderlo no lo cambia. La comprensión vive en una parte del cerebro y el patrón vive en otra. Por eso puedes saber exactamente qué te pasa y seguir haciéndolo igual.",
    offerFraming:
      "No necesitas comprometerte con un proceso largo para saber si esto es para ti. Necesitas una sesión y comprobarlo.",
    riskReversal:
      "Una sola sesión, sin compromiso posterior. Si después quieres continuar, lo que pagaste cuenta como tu primera sesión del paquete que elijas.",
    ctaLabel: "Reservar mi primera sesión",
    whatsappIntro:
      "Hola Dayana, hice el diagnóstico en tu página y me salió que estoy empezando a mirar el tema.",
  },
  EN_PROCESO: {
    name: "Ya lo identificaste, ahora hay que moverlo",
    tagline: "Sabes cuál es el patrón. Lo que no sabes es cómo salir de él.",
    mirror:
      "Llevas tiempo con esto y ya no es un mal día: es un modo de funcionar. Lo reconoces mientras está pasando, te ves haciéndolo, y aun así no puedes pararlo. Ese es exactamente el punto en el que la fuerza de voluntad deja de servir.",
    whyItFailed:
      "Lo que has intentado trabaja con la parte consciente: entender, decidir, esforzarse. Pero el patrón se instaló antes, en una parte que no responde a argumentos. Por eso decides cambiar el lunes y el jueves ya volviste al mismo sitio. No es falta de disciplina.",
    offerFraming:
      "Un patrón de años no se desarma en una sesión, pero tampoco necesita veinticuatro. Necesita suficientes encuentros seguidos para que el cambio se sostenga solo.",
    riskReversal:
      "Empiezas en cuestión de días, no de semanas. Cada sesión admite reprogramación avisando con tiempo. Si en la primera sientes que no es tu camino, lo hablamos.",
    ctaLabel: "Empezar mi proceso",
    whatsappIntro:
      "Hola Dayana, hice el diagnóstico en tu página y me salió que ya identifiqué el patrón pero no logro moverlo.",
  },
  RAIZ_PROFUNDA: {
    name: "Esto viene de raíz",
    tagline: "No es una etapa. Es una estructura, y lleva años sosteniéndose.",
    mirror:
      "Lo que describiste no aparece por un evento reciente. Está en varias áreas de tu vida a la vez y por eso cada vez que resuelves una, la siguiente se enciende. Estás tratando síntomas de algo que tiene una sola raíz, y esa raíz sigue intacta.",
    whyItFailed:
      "Trabajar esto por encima da alivio y el alivio confunde: parece progreso. Pero mientras la creencia de base siga en pie, el patrón se reconstruye con otra cara. Por eso has sentido que avanzas y vuelves al mismo punto.",
    offerFraming:
      "Un proceso de raíz necesita continuidad. No porque sea más difícil, sino porque hay que sostener el cambio mientras el sistema entero se reorganiza alrededor.",
    riskReversal:
      "Empiezas esta semana. El calendario se arma contigo y cada sesión admite reprogramación. Si quieres hablarlo antes de decidir, escríbeme y lo miramos juntas.",
    ctaLabel: "Empezar mi proceso",
    whatsappIntro:
      "Hola Dayana, hice el diagnóstico en tu página y me salió que lo mío viene de raíz.",
  },
};

/**
 * "Lo que está pasando", explicado según el dolor que eligió en la pregunta 1.
 *
 * Esto es lo que hace que el resultado se lea escrito para una persona y no
 * generado. Sin este bloque, tres perfiles cubren a todo el mundo y la página
 * suena a horóscopo.
 */
export const PAIN_COPY: Record<string, { title: string; body: string }> = {
  ansiedad: {
    title: "La ansiedad no es el problema. Es la alarma.",
    body: "Tu sistema aprendió en algún momento que el mundo no es seguro y desde entonces vigila. No está roto: está haciendo su trabajo con información vieja. Reprogramar no es apagar la alarma a la fuerza, es actualizar la información que la dispara.",
  },
  pareja: {
    title: "Repites el vínculo, no la persona.",
    body: "Los patrones de relación se aprenden antes de tener palabras, y después el sistema busca lo conocido aunque duela, porque lo conocido se siente seguro. Por eso cambian las caras y la historia se parece. Se trabaja el molde, no la última relación.",
  },
  duelo: {
    title: "Lo que no se procesa, se guarda.",
    body: "Una pérdida o un evento que no terminó de cerrarse queda activo, gastando energía en segundo plano todos los días. No es que no lo hayas superado por falta de tiempo: es que el tiempo por sí solo no cierra nada. Hay que ir al evento y desactivarlo.",
  },
  autoestima: {
    title: "No es que no te valores. Es que aprendiste a no hacerlo.",
    body: "La idea de cuánto vales se instaló muy temprano, dicha por alguien más, y desde entonces la repites como si fuera tuya. Complacer, no pedir, cargar con todo: son estrategias para conseguir un valor que se da por perdido. Se cambia la creencia, no la conducta.",
  },
  proposito: {
    title: "No estás perdido. Estás desconectado.",
    body: "La falta de dirección casi nunca es falta de opciones: es miedo a elegir mal, guardado bajo la sensación de no saber qué quieres. El trabajo no es encontrar tu propósito como si estuviera escondido, es quitar lo que te impide reconocerlo.",
  },
  dinero: {
    title: "Tu techo no es de mercado. Es de programación.",
    body: "La relación con el dinero se hereda entera —lo que se dijo en tu casa sobre tener, sobre merecer, sobre la gente que tiene— y opera como un termostato: cuando pasas de cierto punto, algo se encarga de devolverte abajo. Se cambia el punto de ajuste.",
  },
};

/** Etiqueta corta del perfil, para el CRM y los tags de contacto. */
export const PROFILE_TAG_SLUG: Record<DiagnosticProfileId, string> = {
  EXPLORADOR: "diagnostico-explorador",
  EN_PROCESO: "diagnostico-en-proceso",
  RAIZ_PROFUNDA: "diagnostico-raiz-profunda",
};

export const PROFILE_TAG_LABEL: Record<DiagnosticProfileId, string> = {
  EXPLORADOR: "Diagnóstico · Explorador",
  EN_PROCESO: "Diagnóstico · En proceso",
  RAIZ_PROFUNDA: "Diagnóstico · Raíz profunda",
};

/** Los tres pasos del método. Iguales para todos: es la promesa de la marca. */
export const METHOD_STEPS = [
  {
    title: "Conciencia",
    body: "Localizamos el evento y la creencia que sostienen el patrón. No es hablar del pasado: es encontrar el punto exacto donde se instaló.",
  },
  {
    title: "Reprogramación",
    body: "Se desactiva la carga emocional de ese evento y se reescribe la creencia. Aquí es donde el recuerdo deja de doler y pasa a ser sólo información.",
  },
  {
    title: "Programación de futuro",
    body: "Se instala la respuesta nueva y se prueba en las situaciones que antes te disparaban, para que sostenga sola cuando salgas de la sesión.",
  },
] as const;

/**
 * La respuesta a lo que la persona dijo que la ha frenado.
 *
 * Una página de ventas normal enumera las cinco objeciones y contesta a todas,
 * lo que obliga a leer cuatro párrafos que no van con uno y, de paso, planta
 * objeciones que no se tenían. Aquí se contesta **sólo la suya**, porque la
 * pregunta 10 ya la hizo elegir.
 */
export const OBJECTION_COPY: Record<string, { title: string; body: string }> = {
  dinero: {
    title: "Dijiste que el dinero.",
    body: "Entonces no empieces por el paquete grande. Una sesión suelta cuesta lo que una salida a cenar y te deja saber, con tu caso encima de la mesa y no en teoría, si esto te sirve. Si después decides continuar, ya sabrás exactamente qué estás comprando.",
  },
  tiempo: {
    title: "Dijiste que el tiempo.",
    body: "Es una hora, desde tu casa, sin desplazamiento. La agenda se arma contigo y cada sesión admite reprogramación avisando con tiempo. El tiempo que llevas gastando en sostener el patrón —dándole vueltas, reparándolo, recuperándote— ya es mayor que esto.",
  },
  miedo: {
    title: "Dijiste que tienes miedo de que no funcione.",
    body: "Es la objeción más sensata de todas, y viene de haber probado cosas que no sirvieron. Por eso no te pido que creas nada: la primera sesión es la prueba. Se trabaja un evento concreto tuyo y sales sabiendo si algo se movió, sin tener que esperar tres meses para averiguarlo.",
  },
  desconocimiento: {
    title: "Dijiste que no sabías por dónde empezar.",
    body: "Ya no es el caso: acabas de responder doce preguntas y abajo tienes el punto exacto por donde se empieza en tu caso. Eso era lo único que faltaba.",
  },
  nada: {
    title: "Dijiste que nada te ha frenado, que simplemente no lo habías hecho.",
    body: "Entonces esto es sencillo. No hay una objeción que resolver ni una duda que despejar: hay una decisión que llevas tiempo aplazando sin motivo, y tomarla te va a costar dos minutos menos de los que llevas leyendo.",
  },
};

/**
 * Sólo se muestra a quien contestó "todavía no lo sé" en por qué Dayana.
 *
 * A quien la sigue hace tiempo o llegó por recomendación no hay que
 * convencerla de quién es: ya lo decidió, y repetírselo suena a relleno.
 */
export const AUTHORITY_COPY = {
  title: "Acabas de llegar, así que esto te falta",
  body: "Dayana es Maestra en Programación Neurolingüística y trabaja con la parte del cerebro donde el patrón se instaló, no con consejos ni con motivación. No hay promesa de resultado garantizado ni recetas de siete días: hay un método concreto, una hora contigo, y la parte que sólo puedes poner tú.",
};

/** Etiqueta corta de cada valor de `porqueDayana`, para el CRM. */
export const WHY_DAYANA_LABEL: Record<string, string> = {
  "la-sigo": "La sigue hace tiempo",
  "me-identifique": "Se identificó con algo que dijo",
  recomendacion: "Se la recomendaron",
  "busco-pnl": "Busca PNL concretamente",
  "aun-no-lo-se": "Aún no lo sabe",
};

/** Etiqueta corta de cada valor de `freno`, para el CRM. */
export const OBJECTION_LABEL: Record<string, string> = {
  dinero: "El dinero",
  tiempo: "El tiempo",
  miedo: "Miedo a que no funcione",
  desconocimiento: "No sabía por dónde empezar",
  nada: "Nada en concreto",
};
