/**
 * El FAQ de la página de resultado del diagnóstico. Es también la fuente del
 * `FAQPage` de JSON-LD, así que lo que se escriba aquí puede acabar tal cual
 * en un resultado de búsqueda.
 *
 * El resultado ya no enseña precio: termina en hablar con Dayana por WhatsApp.
 * Por eso aquí no hay preguntas de medios de pago ni de moneda — contestarlas
 * junto a un botón de contacto sería volver a poner el precio por la puerta de
 * atrás. Eso se habla en la conversación.
 *
 * Cuidado con nombrar paquetes: los títulos viven en la tabla `Product` y se
 * editan desde el CRM sin pasar por aquí.
 *
 * El orden importa: las primeras responden a lo que frena escribir (cómo es,
 * cómo empiezo, qué pasa cuando escribo).
 */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "¿Cómo se realizan las sesiones?",
    a: "En vivo, 1 a 1 con Dayana por Google Meet. Cada sesión dura 1 hora y la tomas desde donde estés.",
  },
  {
    q: "¿Cómo empiezo?",
    a: "Escríbele a Dayana por WhatsApp con el botón de tu resultado. El mensaje ya lleva lo que te salió, así que no tienes que explicar nada desde cero.",
  },
  {
    q: "¿Qué pasa cuando le escribo?",
    a: "Dayana lee tu resultado, resuelve tus dudas y te cuenta cómo sería tu proceso. Si decides empezar, coordinan juntas la agenda de tu primera sesión; lo habitual es empezar esa misma semana.",
  },
  {
    q: "¿Puedo reprogramar una sesión?",
    a: "Sí. Cada sesión admite de 1 a 2 reprogramaciones avisando con anticipación por WhatsApp.",
  },
  {
    q: "¿Esto reemplaza a la terapia psicológica?",
    a: "No. La PNL trabaja sobre patrones y creencias, y suma muy bien a un proceso clínico, pero no sustituye un tratamiento psicológico o psiquiátrico. Si estás en tratamiento, coméntalo y lo tenemos en cuenta.",
  },
];
