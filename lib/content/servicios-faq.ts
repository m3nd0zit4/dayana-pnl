/**
 * El FAQ de /servicios. Es también la fuente del `FAQPage` de JSON-LD, así que
 * lo que se escriba aquí puede acabar tal cual en un resultado de búsqueda.
 *
 * Cuidado con nombrar paquetes: la pregunta "¿qué paquete me conviene?" estuvo
 * citando cinco nombres que ya no existían en las tarjetas, porque los títulos
 * viven en la tabla `Product` y se editan desde el CRM sin pasar por aquí. La
 * versión actual no nombra ninguno a propósito — describe el caso y manda al
 * diagnóstico, que sí lee el catálogo real.
 *
 * El orden también importa: las tres primeras responden a lo que frena la
 * compra (cómo es, cuál elijo, qué pasa después). Moneda y medios de pago son
 * detalle operativo y van detrás.
 */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "¿Cómo se realizan las sesiones?",
    a: "En vivo, 1 a 1 con Dayana por Google Meet. Cada sesión dura 1 hora y la tomas desde donde estés.",
  },
  {
    q: "¿Qué paquete me conviene?",
    a: "Si quieres conocer el proceso antes de comprometerte, empieza por una sesión. Si llevas meses o años con lo mismo, lo que necesitas es continuidad y no una sesión suelta. Si prefieres no adivinar, haz el diagnóstico gratuito: son 8 preguntas y al final te decimos cuál te corresponde y por qué.",
  },
  {
    q: "¿Qué pasa después de pagar?",
    a: "Recibes tu confirmación por correo y coordinamos tu agenda por WhatsApp para tu primera sesión. Lo habitual es empezar esa misma semana.",
  },
  {
    q: "¿Puedo reprogramar una sesión?",
    a: "Sí. Cada sesión admite de 1 a 2 reprogramaciones avisando con anticipación por WhatsApp.",
  },
  {
    q: "¿Esto reemplaza a la terapia psicológica?",
    a: "No. La PNL trabaja sobre patrones y creencias, y suma muy bien a un proceso clínico, pero no sustituye un tratamiento psicológico o psiquiátrico. Si estás en tratamiento, coméntalo y lo tenemos en cuenta.",
  },
  {
    q: "¿Cómo puedo pagar?",
    a: "Desde Colombia con Mercado Pago: tarjetas de crédito y débito, PSE, Nequi y efectivo. Desde otros países con PayPal, con tu saldo o con tarjeta. Si prefieres coordinar el pago de otra forma, escríbenos por WhatsApp.",
  },
  {
    q: "¿En qué moneda veo los precios?",
    a: "Detectamos tu país automáticamente: en Colombia verás precios en pesos (COP); fuera de Colombia, en dólares (USD).",
  },
];
