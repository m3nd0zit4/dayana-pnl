import { normalizePhoneInput } from "./phone-input";
import { foldForSearch } from "./crm/search-normalize";

/**
 * Los contactos del celular exportados como .vcf, para saber el número de un
 * chat exportado que solo trae el nombre («Chat de WhatsApp con Laura.txt»).
 *
 * Se lee SOLO en el navegador: el archivo de contactos de Dayana nunca se
 * sube al servidor. Puro, para probarlo.
 */

export type VCardContact = { name: string; phones: string[] };

/** «=C3=A1» → «á» (QUOTED-PRINTABLE, con «=» al final de línea como continuación). */
const decodeQuotedPrintable = (value: string): string => {
  const bytes: number[] = [];
  const text = value.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(text[i]));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
};

const unescape = (value: string) => value.replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ").trim();

export const parseVCards = (raw: string): VCardContact[] => {
  // Líneas dobladas: una que empieza con espacio continúa la anterior; en
  // QUOTED-PRINTABLE, una que termina en «=» también.
  const lines = raw.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: VCardContact[] = [];
  let current: { fn: string | null; n: string | null; phones: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/QUOTED-PRINTABLE/i.test(line)) {
      while (line.endsWith("=") && i + 1 < lines.length) line = `${line.slice(0, -1)}${lines[++i]}`;
    }
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VCARD")) {
      current = { fn: null, n: null, phones: [] };
      continue;
    }
    if (upper.startsWith("END:VCARD")) {
      if (current) {
        const name = current.fn || current.n || "";
        if (name && current.phones.length) out.push({ name, phones: [...new Set(current.phones)] });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const rawValue = line.slice(colon + 1);
    const value = /ENCODING=QUOTED-PRINTABLE/i.test(head) ? decodeQuotedPrintable(rawValue) : rawValue;
    const prop = head.split(";")[0].toUpperCase().replace(/^ITEM\d+\./, "");
    if (prop === "FN") current.fn = unescape(value);
    else if (prop === "N" && !current.n) {
      const [last, first, middle] = value.split(";").map(unescape);
      current.n = [first, middle, last].filter(Boolean).join(" ").trim() || null;
    } else if (prop === "TEL") {
      const phone = normalizePhoneInput(value.replace(/^tel:/i, ""));
      if (phone) current.phones.push(phone);
    }
  }
  return out;
};

/**
 * Nombre (como lo escribe WhatsApp en el archivo) → número, solo si es único:
 * dos contactos con el mismo nombre o un contacto con varios números no se
 * adivinan.
 */
export const phoneByName = (contacts: VCardContact[]): Map<string, string> => {
  const seen = new Map<string, string | null>();
  for (const c of contacts) {
    const key = foldForSearch(c.name).replace(/\s+/g, " ").trim();
    if (!key) continue;
    const phone = c.phones.length === 1 ? c.phones[0] : null;
    seen.set(key, seen.has(key) ? null : phone);
  }
  return new Map([...seen.entries()].filter((e): e is [string, string] => e[1] !== null));
};

export const lookupPhone = (map: Map<string, string>, name: string): string | null =>
  map.get(foldForSearch(name).replace(/\s+/g, " ").trim()) ?? null;
