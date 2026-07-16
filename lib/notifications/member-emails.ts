import { dispatchAndRecord } from "./dispatch";
import { siteUrl } from "./config";
import { wrapEmailHtml, varsToPlainParagraphs, escapeHtml } from "./templates/email-layout";

const setPasswordUrl = (rawToken: string, callbackUrl?: string | null) =>
  `${siteUrl()}/miembros/crear-cuenta?token=${rawToken}${
    callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""
  }`;

export const sendMemberInviteEmail = async (input: {
  contactId: string;
  firstName: string;
  rawToken: string;
  /** Relative path to land on after setting the password (e.g. a workshop page). */
  callbackUrl?: string | null;
}) => {
  const url = setPasswordUrl(input.rawToken, input.callbackUrl);
  const name = input.firstName.trim() || "Hola";
  const subject = "Tu acceso al portal de miembros";
  const bodyText = [
    `Hola ${name},`,
    "Ya puedes crear tu cuenta del portal de miembros de Dayana Beltrán: clases en vivo, grabaciones y módulos del curso.",
    `Crea tu contraseña aquí (el enlace vence en 7 días): ${url}`,
  ].join("\n\n");

  return dispatchAndRecord({
    contactId: input.contactId,
    channel: "EMAIL",
    templateKey: "member_invite",
    subject,
    body: bodyText,
    text: bodyText,
    html: wrapEmailHtml({
      eyebrow: "Portal de miembros",
      title: "Crea tu cuenta",
      bodyHtml: varsToPlainParagraphs([
        `Hola ${escapeHtml(name)},`,
        "Ya puedes crear tu cuenta del portal de miembros: ahí encontrarás el enlace de las clases en vivo, las grabaciones y los módulos del curso.",
        "El enlace vence en 7 días. Si no lo pediste, puedes ignorar este correo.",
      ]),
      ctaPrimary: { label: "Crear mi contraseña", href: url },
      footnote: "Si el botón no funciona, copia y pega este enlace: " + url,
    }),
  });
};

export const sendMemberPasswordResetEmail = async (input: {
  contactId: string;
  firstName: string;
  rawToken: string;
  /** Relative path to land on after setting the password. */
  callbackUrl?: string | null;
}) => {
  const url = setPasswordUrl(input.rawToken, input.callbackUrl);
  const name = input.firstName.trim() || "Hola";
  const subject = "Restablece tu contraseña del portal";
  const bodyText = [
    `Hola ${name},`,
    "Recibimos una solicitud para restablecer tu contraseña del portal de miembros.",
    `Crea una nueva contraseña aquí (el enlace vence en 2 horas): ${url}`,
  ].join("\n\n");

  return dispatchAndRecord({
    contactId: input.contactId,
    channel: "EMAIL",
    templateKey: "member_password_reset",
    subject,
    body: bodyText,
    text: bodyText,
    html: wrapEmailHtml({
      eyebrow: "Portal de miembros",
      title: "Restablece tu contraseña",
      bodyHtml: varsToPlainParagraphs([
        `Hola ${escapeHtml(name)},`,
        "Recibimos una solicitud para restablecer tu contraseña. Este enlace vence en 2 horas.",
        "Si no fuiste tú, ignora este correo — tu cuenta sigue segura.",
      ]),
      ctaPrimary: { label: "Crear nueva contraseña", href: url },
      footnote: "Si el botón no funciona, copia y pega este enlace: " + url,
    }),
  });
};
