/**
 * El contenido de `/llamada` que todavía depende de material de Dayana: los
 * videos, las fotos y los testimonios. Cada espacio sale en la página como un
 * recuadro con lo que hay que grabar o mandar; cuando llegue el archivo, se
 * pone su ruta en `src` (un `.mp4`/`.webm` en `public/`, una imagen, o un
 * enlace de YouTube) y el recuadro se cambia solo por el video o la foto.
 *
 * Nada de lo que hay aquí es inventado: los nombres y resultados de los
 * testimonios están vacíos hasta que Dayana mande los reales.
 */

export type MediaKind = "video" | "image";

export type MediaSlot = {
  id: string;
  kind: MediaKind;
  /** Lo que dice el recuadro mientras no hay archivo: qué es. */
  label: string;
  /** Qué grabar o qué foto mandar, para Dayana. */
  brief: string;
  /** Ruta en `public/`, URL de imagen o enlace de YouTube. Vacío = recuadro. */
  src?: string;
  /** Portada del video (opcional). */
  poster?: string;
  /** Texto alternativo de la imagen (obligatorio cuando haya `src` de imagen). */
  alt?: string;
  /** Proporción: «16/9», «9/16», «4/5», «1/1». */
  ratio?: "16/9" | "9/16" | "4/5" | "1/1";
};

export type VideoTestimonial = MediaSlot & {
  /** Nombre real de la persona (vacío hasta que llegue). */
  name?: string;
  /** Su cambio en una línea, con sus palabras. Ej.: «De la ansiedad a lanzar su marca». */
  result?: string;
};

/** El video principal, arriba de todo. */
export const MAIN_VIDEO: MediaSlot = {
  id: "video-principal",
  kind: "video",
  ratio: "16/9",
  label: "Video principal",
  brief:
    "Dayana a cámara, 2 a 4 minutos. 1) A quién le habla: personas agotadas, tristes o estancadas que saben que pueden más. 2) Su historia en corto. 3) Su método en dos tiempos: primero sanas lo que te frena, después creces (tu negocio, tu marca, tu contenido). 4) Qué pasa en la llamada gratis. 5) Invitación a agendar con el botón de abajo.",
};

/** El muro de testimonios en video (como la página de referencia: seis, uno debajo del otro en el celular). */
export const VIDEO_TESTIMONIALS: VideoTestimonial[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `testimonio-${n}`,
  kind: "video",
  ratio: "16/9",
  label: `Testimonio en video ${n}`,
  brief:
    "Una persona que trabajó con Dayana, 30 a 90 segundos: cómo llegó (cómo se sentía) y qué cambió después (su paz, su negocio, su marca, sus clientes). Mandar también su nombre y su cambio en una línea.",
}));

/** La sección de comunidad: foto grande de grupo. */
export const COMMUNITY_PHOTO: MediaSlot = {
  id: "foto-comunidad",
  kind: "image",
  ratio: "16/9",
  label: "Foto de la comunidad",
  brief: "Foto de grupo real: una clase, un taller, un encuentro o una captura de una sesión en grupo con varias personas.",
};

/** La historia destacada: foto de la persona + capturas de sus mensajes. */
export const FEATURED_STORY = {
  photo: {
    id: "historia-foto",
    kind: "image",
    ratio: "4/5",
    label: "Foto de la historia destacada",
    brief: "Foto de una persona con un cambio fuerte (con su permiso). Debajo va su historia en dos líneas.",
  } satisfies MediaSlot,
  /** Título de la historia (vacío hasta que llegue). Ej.: «Ana pasó de la tristeza a tener su emprendimiento». */
  title: "",
  /** Una o dos frases con su historia. */
  text: "",
  /** Capturas de WhatsApp de esa persona o de otras (con permiso; sin números visibles). */
  screenshots: [1, 2, 3].map(
    (n): MediaSlot => ({
      id: `captura-${n}`,
      kind: "image",
      ratio: "9/16",
      label: `Captura de mensaje ${n}`,
      brief: "Captura de un mensaje de agradecimiento o de un logro (WhatsApp o Instagram), con permiso y tapando el número.",
    })
  ),
};

/** La foto de Dayana en «Conoce a Dayana». Ya hay una real; se puede cambiar por otra. */
export const DAYANA_PHOTO: MediaSlot = {
  id: "foto-dayana",
  kind: "image",
  ratio: "4/5",
  label: "Foto de Dayana",
  brief: "Foto de Dayana trabajando o a cámara, vertical.",
  src: "/dayana-photos/opt/IMG_4009-900.webp",
  alt: "Dayana Beltrán, Maestra en Programación Neurolingüística",
};

/** El video de la página personal, justo después de agendar («Tu llamada quedó agendada»). */
export const BOOKED_VIDEO: MediaSlot = {
  id: "video-agendada",
  kind: "video",
  ratio: "16/9",
  label: "Tu llamada quedó agendada",
  brief:
    "Dayana, cercana y emotiva, alrededor de 1 minuto: celebra el primer paso que dio la persona, le recuerda que no va sola y le pide tocar «Confirmar por WhatsApp». El texto está en el PDF de guiones.",
};

/**
 * Un video corto de Dayana respondiendo cada pregunta frecuente (dueño, 11-nov:
 * «el texto y aparte un video de Dayana respondiéndolas»). Se ve al abrir la
 * pregunta, encima del texto. La clave es el `id` de la pregunta en la página.
 */
export const FAQ_VIDEOS: Record<string, MediaSlot> = Object.fromEntries(
  (
    [
      ["costo", "¿La llamada tiene costo?"],
      ["como", "¿Cómo es la llamada?"],
      ["terapia-o-negocio", "¿Esto es terapia o es para emprender?"],
      ["sin-negocio", "¿Necesito tener un negocio o saber de redes?"],
      ["otro-pais", "¿Sirve si no vivo en Colombia?"],
      ["talleres", "¿Y los talleres?"],
      ["cambiar-hora", "¿Y si no puedo a la hora que elegí?"],
    ] as const
  ).map(([id, q]) => [
    id,
    {
      id: `faq-${id}`,
      kind: "video",
      ratio: "16/9",
      label: `Pregunta: ${q}`,
      brief: "Dayana responde esta pregunta a cámara, 20 a 40 segundos (el texto está en el PDF de guiones).",
    } satisfies MediaSlot,
  ])
);
