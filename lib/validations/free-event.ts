import { z } from "zod";

/**
 * Lo que el panel puede cambiar de la página de un evento gratuito. Lo
 * comparten `/api/admin/eventos/[id]` y la ruta vieja `/api/admin/webinar`
 * (que trabaja sobre el evento actual).
 */

const faqItemSchema = z.object({
  q: z.string().min(1).max(300),
  a: z.string().min(1).max(2000),
});

export const startsAtLocalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z
    .string()
    .regex(/^\d{1,2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
});

export const freeEventPatchSchema = z.object({
  /** true publica (y cierra el que estuviera publicado); false cierra inscripciones. */
  isActive: z.boolean().optional(),
  headline: z.string().min(1).max(300).optional(),
  subheadline: z.string().max(1000).nullable().optional(),
  body: z.string().max(2000).nullable().optional(),
  startsAtLocal: startsAtLocalSchema.nullable().optional(),
  startsAtIso: z.string().datetime().nullable().optional(),
  // Cadena vacía = "quitar el enlace"; el lib la normaliza a null.
  meetUrl: z.union([z.string().url(), z.literal("")]).nullable().optional(),
  /** Terminar o reabrir a mano lo que el reloj sella solo. */
  ended: z.boolean().optional(),
  /** Cupo previsto; informativo, no cierra el registro. */
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
  learnSectionTitle: z.string().max(120).nullable().optional(),
  learnItems: z.array(z.string().min(1).max(400)).max(12).optional(),
  faq: z.array(faqItemSchema).max(12).optional(),
  ctaLabel: z.string().min(1).max(80).optional(),
  formTitle: z.string().min(1).max(120).optional(),
  metaTitle: z.string().max(120).nullable().optional(),
  metaDescription: z.string().max(320).nullable().optional(),
  // Personalización de la página y del botón en /enlaces.
  eventLabel: z.string().trim().min(1).max(60).optional(),
  locationLabel: z.string().trim().min(1).max(60).optional(),
  priceLabel: z.string().trim().min(1).max(40).optional(),
  faqTitle: z.string().trim().max(120).nullable().optional(),
  materialLabel: z.string().trim().max(60).nullable().optional(),
  successMessage: z.string().trim().max(600).nullable().optional(),
  linkEnabled: z.boolean().optional(),
  linkTitle: z.string().trim().max(80).nullable().optional(),
  linkSubtitle: z.string().trim().max(120).nullable().optional(),
  /** Confirmación por WhatsApp al inscribirse. */
  waConfirmationEnabled: z.boolean().optional(),
});

export type FreeEventPatch = z.infer<typeof freeEventPatchSchema>;

export const freeEventCreateSchema = z.object({
  headline: z.string().trim().max(300).nullish(),
  startsAtLocal: startsAtLocalSchema.nullish(),
  copyFromId: z.string().trim().max(64).nullish(),
});
