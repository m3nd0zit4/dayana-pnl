/**
 * Un E.164 real es "+" seguido solo de dígitos.
 *
 * Los contactos creados por checkout, Google o registro por correo llevan un
 * teléfono marcador de posición ("+pending", "+google:uuid", "+signup:uuid").
 * La regla "solo dígitos" los descarta a todos y también a cualquier prefijo
 * marcador que se invente en el futuro, sin tener que mantener una lista.
 *
 * Vive en su propio módulo, sin dependencias: `lib/env.server.ts` lo importa y
 * corre desde `instrumentation.ts` al arrancar el proceso, así que no puede
 * arrastrar Prisma ni libphonenumber por la cadena de imports.
 */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export const isDialableE164 = (phone: string | null | undefined): boolean =>
  typeof phone === "string" && E164_PATTERN.test(phone);
