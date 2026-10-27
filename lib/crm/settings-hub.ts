import {
  WHATSAPP_SETTINGS,
  WHATSAPP_SETTINGS_TABS,
  normalizeSearch,
} from "./whatsapp-settings-registry";

/**
 * El centro de ajustes: qué hay, agrupado por para qué sirve, y cómo se busca.
 *
 * Los datos viven en `app/config/settings-hub.ts`; aquí están los tipos y el
 * buscador, puros (sin React ni base de datos) para poder probarlos.
 */

export type SettingsHubItem = {
  id: string;
  label: string;
  /** Una línea que dice qué se cambia ahí. */
  hint?: string;
  href: string;
  /** Con qué palabras lo buscaría quien no sabe dónde está. */
  keywords: string[];
  /**
   * `hub`: no sale en las tarjetas (la página entera ya está representada por
   * sus secciones). `nav`: no sale en el menú lateral (es un atajo a una
   * sección de otra página).
   */
  hidden?: "hub" | "nav";
};

export type SettingsHubGroup = {
  id: string;
  title: string;
  /** Para qué sirve el grupo, en una frase. */
  purpose: string;
  /** Solo lo ve quien administra el equipo (OWNER). */
  ownerOnly?: boolean;
  /**
   * Solo para la búsqueda: lo que se cambia en su propia pantalla (precios,
   * mensajes rápidos…) y se encuentra escribiéndolo, pero no tiene tarjeta ni
   * entrada en el menú lateral de Ajustes.
   */
  searchOnly?: boolean;
  items: SettingsHubItem[];
};

export type SettingsHit = {
  id: string;
  label: string;
  /** Dónde vive: el grupo, o «WhatsApp e IA · <pestaña>». */
  where: string;
  href: string;
};

/** Los grupos que se pintan como tarjeta en el índice. */
export const hubCardGroups = (groups: SettingsHubGroup[]): SettingsHubGroup[] =>
  groups.filter((group) => !group.searchOnly);

const WA_TAB_LABEL: Record<string, string> = Object.fromEntries(
  WHATSAPP_SETTINGS_TABS.map((t) => [t.id, t.label])
);

/** Con menos letras que esto no se busca: una sola letra coincide con todo. */
const MIN_QUERY_LENGTH = 2;

/**
 * Palabras de la búsqueda: sin tildes, sin signos y con el plural simple
 * («citas» = «cita»; «contraseña?» = «contrasena»).
 */
const queryWords = (query: string): string[] =>
  normalizeSearch(query)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/**
 * `null` si no coincide; si coincide, más puntos cuantas más palabras estén en
 * la ETIQUETA. Estar solo en la pista o en las palabras clave puntúa cero: así
 * «citas» pone «Horario de citas» por delante de la página genérica cuya pista
 * dice «…horarios y citas…».
 */
const scoreMatch = (words: string[], label: string, rest: string[]): number | null => {
  const normalizedLabel = normalizeSearch(label);
  const haystack = [normalizedLabel, ...rest.map(normalizeSearch)].join(" ");
  if (!words.every((w) => haystack.includes(w))) return null;
  return words.filter((w) => normalizedLabel.includes(w)).length * 10;
};

/**
 * Los ajustes que coinciden con lo escrito, de todo el centro de ajustes: las
 * páginas y secciones de cada grupo y, además, los ajustes sueltos de WhatsApp
 * (que llevan directo a su pestaña y lo resaltan).
 *
 * Páginas y ajustes sueltos compiten con la misma puntuación; a igualdad gana
 * la página. Lo que es solo de OWNER no aparece para quien no lo es: un
 * resultado que rebota confunde más de lo que ayuda.
 */
export const searchSettingsHub = (
  groups: SettingsHubGroup[],
  query: string,
  { isOwner, limit = 10 }: { isOwner: boolean; limit?: number }
): SettingsHit[] => {
  const words = queryWords(query);
  if (words.join("").length < MIN_QUERY_LENGTH) return [];

  const scored: { hit: SettingsHit; score: number }[] = [];

  let order = 0;
  for (const group of groups) {
    if (group.ownerOnly && !isOwner) continue;
    for (const item of group.items) {
      order += 1;
      const base = scoreMatch(words, item.label, [item.hint ?? "", ...item.keywords]);
      if (base === null) continue;
      scored.push({
        hit: { id: item.id, label: item.label, where: group.title, href: item.href },
        score: base - order / 1000,
      });
    }
  }

  // Los ajustes de WhatsApp son de OWNER, como su página.
  if (isOwner) {
    WHATSAPP_SETTINGS.forEach((entry, index) => {
      const base = scoreMatch(words, entry.label, entry.keywords);
      if (base === null) return;
      scored.push({
        hit: {
          id: entry.id,
          label: entry.label,
          where: `WhatsApp e IA · ${WA_TAB_LABEL[entry.tab] ?? entry.tab}`,
          href: `/admin/whatsapp/ajustes?tab=${entry.tab}&ajuste=${entry.id}`,
        },
        // A igualdad, la página va antes que el ajuste suelto.
        score: base - 0.5 - index / 1000,
      });
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.hit)
    .slice(0, limit);
};
