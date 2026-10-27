import {
  WHATSAPP_SETTINGS_TABS,
  normalizeSearch,
  searchWhatsAppSettings,
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
  items: SettingsHubItem[];
};

export type SettingsHit = {
  id: string;
  label: string;
  /** Dónde vive: el grupo, o «WhatsApp e IA · <pestaña>». */
  where: string;
  href: string;
};

const WA_TAB_LABEL: Record<string, string> = Object.fromEntries(
  WHATSAPP_SETTINGS_TABS.map((t) => [t.id, t.label])
);

/** Palabras de la búsqueda, sin tildes y con el plural simple («citas» = «cita»). */
const queryWords = (query: string): string[] =>
  normalizeSearch(query)
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/**
 * Los ajustes que coinciden con lo escrito, de todo el centro de ajustes:
 * las páginas y secciones de cada grupo, y además los ajustes sueltos de
 * WhatsApp (que llevan directo a su pestaña y lo resaltan).
 *
 * Cada palabra tiene que aparecer en la etiqueta, la pista o las palabras
 * clave; primero lo que coincide en la etiqueta. Lo que es solo de OWNER no
 * aparece para quien no lo es: un resultado que rebota confunde más de lo que
 * ayuda.
 */
export const searchSettingsHub = (
  groups: SettingsHubGroup[],
  query: string,
  { isOwner, limit = 10 }: { isOwner: boolean; limit?: number }
): SettingsHit[] => {
  const words = queryWords(query);
  if (words.length === 0) return [];

  const scored: { hit: SettingsHit; score: number }[] = [];
  let order = 0;
  for (const group of groups) {
    if (group.ownerOnly && !isOwner) continue;
    for (const item of group.items) {
      order += 1;
      const label = normalizeSearch(item.label);
      const haystack = [label, normalizeSearch(item.hint ?? ""), ...item.keywords.map(normalizeSearch)].join(" ");
      if (!words.every((w) => haystack.includes(w))) continue;
      const inLabel = words.filter((w) => label.includes(w)).length;
      scored.push({
        hit: { id: item.id, label: item.label, where: group.title, href: item.href },
        score: inLabel * 10 - order / 1000,
      });
    }
  }
  const hubHits = scored.sort((a, b) => b.score - a.score).map((s) => s.hit);

  // Los ajustes de WhatsApp son de OWNER, como su página.
  const waHits: SettingsHit[] = isOwner
    ? searchWhatsAppSettings(query).map((entry) => ({
        id: entry.id,
        label: entry.label,
        where: `WhatsApp e IA · ${WA_TAB_LABEL[entry.tab] ?? entry.tab}`,
        href: `/admin/whatsapp/ajustes?tab=${entry.tab}&ajuste=${entry.id}`,
      }))
    : [];

  return [...hubHits, ...waHits].slice(0, limit);
};
