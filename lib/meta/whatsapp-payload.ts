/**
 * Cuerpos de los mensajes de WhatsApp que arma `send.ts`, sin red ni base de
 * datos (para probarlos). Solo lo que cambia según el mensaje: el destinatario,
 * la cita y la autenticación los pone quien llama.
 */

/**
 * Una imagen para WhatsApp: el `id` de un medio ya subido a `/media` (vale
 * 30 días y se reutiliza en todos los envíos) o un enlace público.
 */
export type WhatsAppImageRef = { id: string } | { link: string };

export type WhatsAppTemplateInput = {
  name: string;
  language: string;
  /** Parámetros posicionales del cuerpo de la plantilla. */
  variables?: string[];
  /** Imagen de la cabecera, solo para plantillas aprobadas con cabecera IMAGE. */
  headerImage?: WhatsAppImageRef | null;
};

/** Solo `id` o solo `link`: un objeto con más claves Meta lo rechaza. */
export const imageRefPayload = (ref: WhatsAppImageRef): { id: string } | { link: string } =>
  "id" in ref ? { id: ref.id } : { link: ref.link };

/**
 * El objeto `template` del mensaje. Sin variables ni imagen no lleva
 * `components` (igual que antes); con imagen, la cabecera va primero.
 */
export const buildTemplatePayload = (template: WhatsAppTemplateInput) => {
  const components: Record<string, unknown>[] = [];
  if (template.headerImage) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: imageRefPayload(template.headerImage) }],
    });
  }
  if (template.variables?.length) {
    components.push({
      type: "body",
      parameters: template.variables.map((text) => ({ type: "text", text })),
    });
  }
  return {
    name: template.name,
    language: { code: template.language },
    ...(components.length ? { components } : {}),
  };
};

export type WhatsAppMediaKind = "image" | "video" | "audio" | "document" | "sticker";

/**
 * El objeto del medio (`image`, `document`…): el medio, su pie si lo admite y
 * el nombre del archivo si es documento.
 */
export const buildMediaPayload = (input: {
  kind: WhatsAppMediaKind;
  media: WhatsAppImageRef;
  caption?: string | null;
  filename?: string | null;
}) => ({
  ...imageRefPayload(input.media),
  ...(input.caption ? { caption: input.caption } : {}),
  ...(input.kind === "document" && input.filename ? { filename: input.filename } : {}),
});
