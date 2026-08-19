import type { DiagnosticProfileId } from "@/lib/diagnostico/scoring";

/**
 * Los testimonios, en un solo sitio.
 *
 * Estaban embebidos dentro de `TestimonialsSection.tsx`, lo que significaba
 * que la home era la única página que podía enseñarlos. Ahora los comparten la
 * home, `/historias` y la página de resultado del diagnóstico — y esa última
 * es la que justifica el campo `profiles`: la prueba social convence mucho más
 * cuando quien la firma se parece a quien la lee.
 */

export type Testimonial = {
  id: number;
  name: string;
  excerpt: string;
  youtubeId: string;
  /** De qué venía. Frase corta, en su propio lenguaje. */
  cameFrom: string;
  /** Perfiles del diagnóstico a los que se le muestra este testimonio. */
  profiles: DiagnosticProfileId[];
};

export const TESTIMONIOS: Testimonial[] = [
  {
    id: 1,
    name: "Teresa",
    excerpt:
      "Estaba pasando por un momento muy difícil y no encontraba la salida. Gracias a las herramientas de Dayana, hoy me siento renovada, con una paz interior increíble y la fuerza para seguir adelante.",
    youtubeId: "LnumJ4E208Y",
    cameFrom: "No encontraba la salida",
    profiles: ["EN_PROCESO", "RAIZ_PROFUNDA"],
  },
  {
    id: 2,
    name: "Luz",
    excerpt:
      "Llegué en un momento de crisis emocional, pero gracias al proceso con Dayana hoy tengo una visión clara, enfoque y, sobre todo, una armonía que me permite tomar mejores decisiones para mi vida.",
    youtubeId: "uUqnsYrpXck",
    cameFrom: "Crisis emocional",
    profiles: ["EN_PROCESO", "EXPLORADOR"],
  },
  {
    id: 3,
    name: "Glenda",
    excerpt:
      "He logrado identificar y reprogramar esas ideas limitantes y traumas del pasado que no me dejaban avanzar. Pasé de estar en modo supervivencia a vivir con libertad, consciencia y valentía.",
    youtubeId: "ccWpOuvL90I",
    cameFrom: "Traumas del pasado, modo supervivencia",
    profiles: ["RAIZ_PROFUNDA"],
  },
  {
    id: 4,
    name: "Nury",
    excerpt:
      "A través de estas terapias aprendí a priorizarme y a encontrar una seguridad que no tenía. Me siento mucho más tranquila; ha sido un cambio profundo y favorable para mi bienestar personal.",
    youtubeId: "KHlVFKENIFw",
    cameFrom: "No sabía priorizarse",
    profiles: ["EXPLORADOR", "EN_PROCESO"],
  },
];

/**
 * Testimonio que mejor encaja con un perfil. Si ninguno lo declara —porque se
 * añadió un perfil y todavía no se ha etiquetado a nadie— devuelve el primero
 * en vez de nada: un hueco en la página de resultado es peor que una historia
 * que encaja sólo a medias.
 */
export const testimonialForProfile = (
  profile: DiagnosticProfileId,
): Testimonial =>
  TESTIMONIOS.find((t) => t.profiles.includes(profile)) ?? TESTIMONIOS[0];

export const youtubeThumb = (youtubeId: string): string =>
  `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;

export const youtubeWatchUrl = (youtubeId: string): string =>
  `https://www.youtube.com/watch?v=${youtubeId}`;
