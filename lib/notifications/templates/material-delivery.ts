import { BRAND } from "@/lib/contact";
import { escapeHtml, wrapEmailHtml } from "./email-layout";

/**
 * El correo con el material prometido en un video: «comenta ÉXITO y te lo
 * mando». Llega después de que la persona ya lo vio en pantalla, así que no
 * es la única vía de entrega — es la copia que le queda en el correo.
 */

export type MaterialDeliveryInput = {
  firstName: string;
  /** Título del material, tal como se anunció. */
  title: string;
  description?: string | null;
  /** Enlace o archivo. Siempre absoluto: en el correo no hay sitio de origen. */
  deliveryUrl: string;
  /** La palabra que escribió en el comentario, para que reconozca de qué va. */
  keywordLabel: string;
};

export const materialDeliverySubject = (i: MaterialDeliveryInput): string =>
  `Aquí está: ${i.title}`;

export const materialDeliveryHtml = (i: MaterialDeliveryInput): string =>
  wrapEmailHtml({
    title: i.title,
    eyebrow: `Escribiste «${i.keywordLabel}»`,
    preheader: `Tu material: ${i.title}`,
    bodyHtml: `<p style="margin:0 0 14px;">Hola ${escapeHtml(i.firstName)}, aquí tienes lo que te prometí.</p>${
      i.description
        ? `<p style="margin:0 0 14px;">${escapeHtml(i.description)}</p>`
        : ""
    }<p style="margin:0;">Guarda este correo: el enlace te sirve cuando quieras.</p>`,
    ctaPrimary: { href: i.deliveryUrl, label: "Abrir el material" },
    footnote: `Si el botón no abre, copia este enlace: ${i.deliveryUrl}`,
  });

export const materialDeliveryText = (i: MaterialDeliveryInput): string =>
  [
    `Hola ${i.firstName},`,
    ``,
    `Aquí tienes lo que te prometí: ${i.title}.`,
    i.description ? i.description : null,
    ``,
    `Ábrelo aquí: ${i.deliveryUrl}`,
    ``,
    `Guarda este correo: el enlace te sirve cuando quieras.`,
    ``,
    BRAND.name,
  ]
    // Solo fuera lo que no aplica; las líneas vacías separan párrafos.
    .filter((line): line is string => line !== null)
    .join("\n");
