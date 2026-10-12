/**
 * Un teléfono escrito a mano o sacado de un contacto del celular → E.164.
 * Puro y sin dependencias: lo usan el servidor y el navegador.
 */

/** Marcas invisibles que WhatsApp y los celulares meten en nombres y números. */
export const INVISIBLE_MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;

/**
 * «+57 300 123 4567», «+52 1 55 1234 5678», «3001234567» → E.164. Sin «+» y
 * con 10 dígitos que empiezan por 3 se asume Colombia. null si no parece un
 * número.
 */
export const normalizePhoneInput = (raw: string): string | null => {
  const text = raw.replace(INVISIBLE_MARKS, "").trim();
  if (!/^[+\d][\d\s().-]*$/.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10 && digits.startsWith("3")) return `+57${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
};
