/**
 * Índice de todos los ajustes de WhatsApp: en qué pestaña vive cada uno y con
 * qué palabras lo buscaría Dayana. Lo usa el buscador de Ajustes → WhatsApp.
 *
 * El `id` es también el `id` del elemento en la página: al elegir un resultado
 * se cambia de pestaña y se hace scroll hasta él. Puro (sin React ni base de
 * datos) para poder probarlo.
 */

export const WHATSAPP_SETTINGS_TABS = [
  { id: "conexion", label: "Conexión" },
  { id: "ia", label: "IA y respuestas" },
  { id: "citas", label: "Horarios y citas" },
  { id: "avisos", label: "Avisos" },
  { id: "plantillas", label: "Plantillas" },
  { id: "avanzado", label: "Avanzado" },
] as const;

export type WhatsAppSettingsTab = (typeof WHATSAPP_SETTINGS_TABS)[number]["id"];

export const DEFAULT_WHATSAPP_SETTINGS_TAB: WhatsAppSettingsTab = "ia";

export const isWhatsAppSettingsTab = (v: unknown): v is WhatsAppSettingsTab =>
  WHATSAPP_SETTINGS_TABS.some((t) => t.id === v);

export type WhatsAppSettingEntry = {
  id: string;
  label: string;
  keywords: string[];
  tab: WhatsAppSettingsTab;
};

export const WHATSAPP_SETTINGS: WhatsAppSettingEntry[] = [
  // ── Siempre a la vista (cabecera) ──────────────────────────────────────
  {
    id: "wa-ai-enabled",
    label: "IA encendida o apagada",
    keywords: ["encender", "apagar", "activar", "desactivar", "respuesta automática", "asistente", "robot", "pausar"],
    tab: "ia",
  },
  {
    id: "wa-default-mode",
    label: "Modo de los chats nuevos (IA, Copiloto, Manual)",
    keywords: ["modo", "copiloto", "manual", "automático", "borrador", "aprobar", "chats nuevos"],
    tab: "ia",
  },

  // ── Conexión ───────────────────────────────────────────────────────────
  {
    id: "wa-provider",
    label: "Proveedor y número de WhatsApp",
    keywords: ["360dialog", "meta", "clave", "api", "conectar", "número", "coexistencia", "webhook", "proveedor"],
    tab: "conexion",
  },
  {
    id: "wa-inbox-health",
    label: "Estado de la bandeja (mensajes pendientes)",
    keywords: ["cola", "pendientes", "reprocesar", "llegan", "salud", "errores", "mensajes perdidos"],
    tab: "conexion",
  },
  {
    id: "wa-history-import",
    label: "Importar historial de chats",
    keywords: ["historial", "importar", "subir", "360dialog", "hub", "chats antiguos", "zip", "json"],
    tab: "conexion",
  },
  {
    id: "wa-phone-export-import",
    label: "Importar chats del celular",
    keywords: ["exportar chat", "celular", "txt", "sin archivos", "chats antiguos", "importar", "historial"],
    tab: "conexion",
  },
  {
    id: "wa-chat-backup",
    label: "Respaldo de chats",
    keywords: ["respaldo", "backup", "copia", "descargar chats", "exportar"],
    tab: "conexion",
  },

  // ── IA y respuestas ────────────────────────────────────────────────────
  {
    id: "wa-identity",
    label: "Cómo se presenta la IA",
    keywords: ["identidad", "presentación", "voz", "primera persona", "tercera persona", "asistente de dayana"],
    tab: "ia",
  },
  {
    id: "wa-audience-known",
    label: "No responder a mi libreta personal",
    keywords: ["contactos", "familia", "amigos", "libreta", "a quién responde", "audiencia"],
    tab: "ia",
  },
  {
    id: "wa-audience-customers",
    label: "No responder a clientes que ya pagaron",
    keywords: ["clientes", "pagaron", "proceso activo", "a quién responde", "audiencia"],
    tab: "ia",
  },
  {
    id: "wa-reset",
    label: "Empezar limpio (lo que aprendió la IA)",
    keywords: ["limpiar", "aprendió", "aprendizaje", "ejemplos", "propuestas", "memoria", "reiniciar", "borrar", "empezar de cero"],
    tab: "ia",
  },
  {
    id: "wa-context-v2",
    label: "Leer el historial completo del chat",
    keywords: ["historial", "contexto", "memoria", "primera vez", "saluda", "mensajes anteriores", "lee"],
    tab: "ia",
  },
  {
    id: "wa-dossier",
    label: "Ficha de cada persona",
    keywords: ["ficha", "resumen", "memoria", "historial", "persona", "quién es", "contexto"],
    tab: "ia",
  },
  {
    id: "wa-dossier-build",
    label: "Construir fichas",
    keywords: ["fichas", "construir", "armar", "importar", "historial", "resumen"],
    tab: "ia",
  },
  {
    id: "wa-segments",
    label: "Quién es quién (estados)",
    keywords: ["segmento", "estado", "clienta", "nueva", "calcular", "quién es", "clientes", "no contestó", "tuvo la llamada", "en proceso"],
    tab: "ia",
  },
  {
    id: "wa-client-review",
    label: "Clientas por revisar",
    keywords: ["revisar", "clienta", "pagó", "transferencia", "comprobante", "no es clienta"],
    tab: "ia",
  },
  {
    id: "wa-router",
    label: "Quién atiende a quién (modo por persona)",
    keywords: ["modo", "copiloto", "segmento", "clientas", "nuevas", "quién atiende", "enrutador", "automático"],
    tab: "ia",
  },
  {
    id: "wa-router-new_lead",
    label: "Modo para personas nuevas",
    keywords: ["nueva", "primera vez", "ia", "copiloto"],
    tab: "ia",
  },
  {
    id: "wa-router-returning_lead",
    label: "Modo para quien ya conversó",
    keywords: ["ya conversó", "volvió", "copiloto"],
    tab: "ia",
  },
  {
    id: "wa-router-free_call_booked",
    label: "Modo para llamada agendada",
    keywords: ["llamada gratis", "agendada", "agendó"],
    tab: "ia",
  },
  {
    id: "wa-router-after_call",
    label: "Modo para quien ya tuvo la llamada",
    keywords: ["llamada gratis", "después de la llamada", "no compró", "cerrar venta"],
    tab: "ia",
  },
  {
    id: "wa-router-client",
    label: "Modo para clientas",
    keywords: ["clienta", "pagó", "tú", "manual"],
    tab: "ia",
  },
  {
    id: "wa-router-ignored",
    label: "Modo para personal o equipo",
    keywords: ["personal", "equipo", "familia", "empresa"],
    tab: "ia",
  },
  {
    id: "wa-router-max-new",
    label: "Respuestas por día a quien no es clienta",
    keywords: ["máximo", "por día", "respuestas", "nueva", "límite", "tope"],
    tab: "ia",
  },
  {
    id: "wa-pay-receipts",
    label: "Recibir comprobantes de pago",
    keywords: ["comprobante", "pago", "transferencia", "recibo", "confirmar pago", "cliente"],
    tab: "ia",
  },
  {
    id: "wa-pay-links",
    label: "Reenviar el enlace de pago",
    keywords: ["enlace de pago", "link", "pagar", "reenviar"],
    tab: "ia",
  },
  {
    id: "wa-community",
    label: "Mandar el enlace de la comunidad",
    keywords: ["comunidad", "grupo", "enlace", "unirse", "agregar al grupo", "whatsapp"],
    tab: "ia",
  },
  {
    id: "wa-community-link",
    label: "Enlace de la comunidad",
    keywords: ["comunidad", "grupo", "enlace", "invitación", "link"],
    tab: "ia",
  },
  {
    id: "wa-affordable",
    label: "Ofrecer algo más económico",
    keywords: ["económico", "barato", "no le alcanza", "curso", "ahorrar", "comunidad", "dinero"],
    tab: "ia",
  },
  {
    id: "wa-affordable-options",
    label: "Opciones más económicas",
    keywords: ["económico", "curso", "curso en vivo", "opciones", "enlace", "no le alcanza"],
    tab: "ia",
  },
  {
    id: "wa-pay-methods",
    label: "Formas de pago (cuentas)",
    keywords: ["cuenta", "bancolombia", "western union", "global66", "remitly", "datos de pago", "transferencia", "pagar"],
    tab: "ia",
  },
  {
    id: "wa-sales-flow",
    label: "Flujo de primera vez (llevar a la llamada gratis)",
    keywords: ["primera vez", "flujo", "venta", "llamada gratis", "invitar", "nuevas", "agendar"],
    tab: "ia",
  },
  {
    id: "wa-free-autobook",
    label: "Agendar la llamada gratis sola",
    keywords: ["agendar sola", "llamada gratis", "sin aprobar", "automático", "calendario"],
    tab: "ia",
  },
  {
    id: "wa-free-max",
    label: "Llamadas gratis por día",
    keywords: ["tope", "máximo", "llamadas gratis", "por día", "cupos"],
    tab: "ia",
  },
  {
    id: "wa-sales-buttons",
    label: "Preguntas clave (tristeza, ansiedad…)",
    keywords: ["pregunta clave", "tristeza", "ansiedad", "botones", "cuánto tiempo más", "emociones"],
    tab: "ia",
  },
  {
    id: "wa-waiting-room",
    label: "Sala de espera de la llamada gratis",
    keywords: ["sala de espera", "reunión", "espera", "5 minutos", "llamada gratis", "ocupada"],
    tab: "ia",
  },
  {
    id: "wa-call-followup",
    label: "Saber si se hizo la llamada gratis y reagendar si no contestó",
    keywords: ["no contestó", "reagendar", "llamada perdida", "no asistió", "seguimiento", "llamada gratis"],
    tab: "ia",
  },
  {
    id: "wa-call-followup-hours",
    label: "Horas para dar la llamada por no contestada",
    keywords: ["horas", "no contestó", "sin respuesta", "reagendar"],
    tab: "ia",
  },
  {
    id: "wa-waiting-proactive",
    label: "Avisar de la espera aunque no escriba",
    keywords: ["sala de espera", "reloj", "avisar", "proactivo"],
    tab: "ia",
  },
  {
    id: "wa-classify",
    label: "Clasificar los chats",
    keywords: ["clasificar", "categoría", "personal", "negocio", "apps", "silenciar", "callar", "google"],
    tab: "ia",
  },
  {
    id: "wa-classify-preview",
    label: "Vista previa de la clasificación",
    keywords: ["vista previa", "clasificar", "categorías", "cuántos", "revisar"],
    tab: "ia",
  },
  {
    id: "wa-classify-run",
    label: "Clasificar todos ahora",
    keywords: ["clasificar todos", "categorías", "reglas", "ia"],
    tab: "ia",
  },
  {
    id: "wa-team-phones",
    label: "Números del equipo",
    keywords: ["equipo", "números", "teléfonos", "staff", "no contestar"],
    tab: "ia",
  },
  {
    id: "wa-schedule",
    label: "Cuándo responde la IA (horario)",
    keywords: ["horario", "horas", "días", "noche", "fuera de horario", "siempre", "cuándo responde"],
    tab: "ia",
  },
  {
    id: "wa-max-per-day",
    label: "Máximo de respuestas por chat al día",
    keywords: ["límite", "tope", "máximo", "respuestas", "24 horas", "límites"],
    tab: "ia",
  },
  {
    id: "wa-pause-human",
    label: "Apartarse cuando contestas tú",
    keywords: ["pausa", "pausar", "apartarse", "cuando contesto", "relevo", "sigue contestando"],
    tab: "ia",
  },
  {
    id: "wa-pause-escalation",
    label: "Callarse al pasarte algo",
    keywords: ["pausa", "escalar", "callarse", "te toca", "sigue contestando", "escalada"],
    tab: "ia",
  },
  {
    id: "wa-media-cleanup",
    label: "Limpiar fotos y audios viejos",
    keywords: ["limpieza", "borrar", "fotos", "imágenes", "audios", "videos", "espacio", "almacenamiento", "blob"],
    tab: "ia",
  },
  {
    id: "wa-media-keep-days",
    label: "Cuántos días se guardan fotos y audios",
    keywords: ["limpieza", "días", "guardar", "fotos", "audios", "borrar", "almacenamiento"],
    tab: "ia",
  },
  {
    id: "wa-handoff-hours",
    label: "Cuándo vuelve la IA después de que contestas",
    keywords: ["volver", "horas", "retomar", "cuando contesto", "pausa", "límites"],
    tab: "ia",
  },
  {
    id: "wa-holding-message",
    label: "Mensaje al pasarte un chat",
    keywords: ["escalar", "pasar chat", "espera", "mensaje de espera", "te paso", "escalada"],
    tab: "ia",
  },
  {
    id: "wa-instructions",
    label: "Instrucciones para la IA",
    keywords: ["instrucciones", "reglas", "qué evitar", "qué saber", "indicaciones", "prompt"],
    tab: "ia",
  },
  {
    id: "wa-style-guide",
    label: "Tu forma de escribir (guía de estilo)",
    keywords: ["estilo", "tono", "emojis", "saludo", "forma de escribir", "guía"],
    tab: "ia",
  },
  {
    id: "wa-learning",
    label: "Aprender de mis respuestas",
    keywords: ["aprender", "ejemplos", "aprendizaje", "imitar", "mis respuestas"],
    tab: "ia",
  },
  {
    id: "wa-playbooks",
    label: "Procedimientos",
    keywords: ["procedimientos", "situaciones", "pasos", "reglas", "playbook", "correcciones"],
    tab: "ia",
  },
  {
    id: "wa-tester",
    label: "Probar qué contestaría la IA",
    keywords: ["probar", "prueba", "simular", "vista previa", "test"],
    tab: "ia",
  },

  // ── Horarios y citas ───────────────────────────────────────────────────
  {
    id: "wa-booking-enabled",
    label: "La IA agenda citas sola",
    keywords: ["citas", "agendar", "agenda", "reservas", "calendario", "booking"],
    tab: "citas",
  },
  {
    id: "wa-booking-account",
    label: "Calendario de Google donde agenda",
    keywords: ["google", "calendar", "calendario", "cuenta", "citas", "agenda"],
    tab: "citas",
  },
  {
    id: "wa-booking-url",
    label: "Enlace para agendar",
    keywords: ["enlace", "link", "página de citas", "citas", "agendar", "url"],
    tab: "citas",
  },
  {
    id: "wa-booking-services",
    label: "Qué se puede agendar (servicios y duración)",
    keywords: ["servicios", "duración", "minutos", "sesión", "consulta", "citas"],
    tab: "citas",
  },
  {
    id: "wa-booking-hours",
    label: "Horario de citas",
    keywords: ["horario", "disponibilidad", "días", "horas", "citas", "franjas"],
    tab: "citas",
  },
  {
    id: "wa-booking-buffer",
    label: "Respiro entre citas",
    keywords: ["respiro", "descanso", "margen", "entre citas", "buffer", "minutos"],
    tab: "citas",
  },
  {
    id: "wa-booking-notice",
    label: "Antelación mínima para agendar",
    keywords: ["antelación", "aviso", "mínimo", "horas antes", "citas"],
    tab: "citas",
  },
  {
    id: "wa-booking-horizon",
    label: "Hasta cuántos días agenda",
    keywords: ["días", "adelante", "horizonte", "futuro", "citas"],
    tab: "citas",
  },
  {
    id: "wa-booking-meet",
    label: "Enlace de Google Meet en cada cita",
    keywords: ["meet", "videollamada", "google meet", "enlace", "citas"],
    tab: "citas",
  },
  {
    id: "wa-free-reminder",
    label: "Recordarle la llamada gratis antes de la hora",
    keywords: ["recordatorio", "recordar", "1 hora antes", "hoy", "llamada gratis", "aviso", "citas", "espacio tranquilo"],
    tab: "citas",
  },
  {
    id: "wa-free-reminder-minutes",
    label: "Cuánto antes se recuerda la llamada gratis",
    keywords: ["recordatorio", "minutos", "antes", "1 hora", "llamada gratis", "citas"],
    tab: "citas",
  },
  {
    id: "wa-free-reminder-message",
    label: "Mensaje del recordatorio de la llamada gratis",
    keywords: ["recordatorio", "mensaje", "texto", "llamada gratis", "citas"],
    tab: "citas",
  },

  // ── Avisos ─────────────────────────────────────────────────────────────
  {
    id: "wa-push",
    label: "Avisos en este dispositivo",
    keywords: ["notificaciones", "push", "avisos", "celular", "teléfono", "alertas"],
    tab: "avisos",
  },
  {
    id: "wa-notify",
    label: "A quién avisar cuando la IA pasa un chat",
    keywords: ["notificar", "equipo", "solo a mí", "avisos", "dueña", "alertas"],
    tab: "avisos",
  },
  {
    id: "wa-outreach",
    label: "Escribir a quien termina la autoevaluación",
    keywords: ["autoevaluación", "diagnóstico", "test", "escribir", "contactar", "aprobación"],
    tab: "avisos",
  },
  {
    id: "wa-welcome",
    label: "Saludo de bienvenida",
    keywords: ["bienvenida", "saludo", "primer mensaje", "botón", "hola"],
    tab: "avisos",
  },

  // ── Plantillas ─────────────────────────────────────────────────────────
  {
    id: "wa-templates",
    label: "Plantillas de mensajes",
    keywords: ["plantillas", "templates", "meta", "aprobadas", "24 horas", "envíos masivos"],
    tab: "plantillas",
  },

  // ── Avanzado ───────────────────────────────────────────────────────────
  {
    id: "wa-learn-inbox",
    label: "Aprender de la bandeja ahora",
    keywords: ["aprender", "bandeja", "conversaciones", "actualizar ejemplos"],
    tab: "avanzado",
  },
  {
    id: "wa-import-chat",
    label: "Subir un chat exportado (.txt)",
    keywords: ["exportar", "chat", "txt", "importar", "subir", "aprender"],
    tab: "avanzado",
  },
  {
    id: "wa-examples",
    label: "Respuestas aprendidas",
    keywords: ["ejemplos", "aprendidas", "respuestas", "apagar ejemplos", "aprender"],
    tab: "avanzado",
  },
  {
    id: "wa-retention",
    label: "Cuánto tiempo se guardan los datos",
    keywords: ["retención", "borrar", "datos", "privacidad", "días", "guardan"],
    tab: "avanzado",
  },
];

/** Minúsculas, sin tildes ni espacios de más: «Días» y «dias» son lo mismo. */
export const normalizeSearch = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Ajustes que coinciden con lo escrito. Cada palabra tiene que aparecer en la
 * etiqueta o en las palabras clave; primero los que coinciden en la etiqueta.
 * Un plural simple («citas» / «cita») cuenta igual.
 */
export const searchWhatsAppSettings = (
  query: string,
  entries: WhatsAppSettingEntry[] = WHATSAPP_SETTINGS
): WhatsAppSettingEntry[] => {
  const words = normalizeSearch(query)
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  if (words.length === 0) return [];

  const scored = entries.flatMap((entry, index) => {
    const label = normalizeSearch(entry.label);
    const haystack = `${label} ${entry.keywords.map(normalizeSearch).join(" ")}`;
    if (!words.every((w) => haystack.includes(w))) return [];
    const inLabel = words.filter((w) => label.includes(w)).length;
    return [{ entry, score: inLabel * 10 - index / 1000 }];
  });

  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
};
