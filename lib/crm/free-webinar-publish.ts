export type PublishBlocker =
  | "headline"
  | "subheadline"
  | "startsAt"
  | "learnItems"
  | "ctaLabel"
  | "formTitle";

export const PUBLISH_BLOCKER_LABELS: Record<PublishBlocker, string> = {
  headline: "Titular",
  subheadline: "Subtítulo",
  startsAt: "Fecha",
  learnItems: "Al menos un tema / punto a cubrir",
  ctaLabel: "Texto del botón",
  formTitle: "Título del formulario",
};

export type FreeWebinarFaqItem = { q: string; a: string };
