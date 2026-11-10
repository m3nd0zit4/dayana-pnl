import { attributionFromUrl, hasAttribution, parseAttribution, type Attribution } from "@/lib/crm/call-funnel/rules";

/**
 * De dónde llegó la persona al embudo de la llamada gratis, de primer toque.
 *
 * Quien llega por un reel con `?utm_source=instagram`, mira, se va y vuelve
 * dos días después escribiendo la dirección, llegó por el reel: lo primero que
 * se guardó con algo que diga de dónde vino no se pisa nunca. Va en
 * `sessionStorage` y en `localStorage` (el navegador de Instagram y TikTok a
 * veces borra uno y no el otro), y si ninguno deja escribir —modo privado,
 * almacenamiento bloqueado— queda en memoria para lo que dure la página.
 */

export const ATTRIBUTION_KEY = "dayana_llamada_origen";

let memory: Attribution | null = null;

const stores = (): Storage[] => {
  const out: Storage[] = [];
  // El acceso mismo puede lanzar (almacenamiento bloqueado por el navegador).
  try {
    out.push(window.localStorage);
  } catch {
    /* sin localStorage */
  }
  try {
    out.push(window.sessionStorage);
  } catch {
    /* sin sessionStorage */
  }
  return out;
};

const readFrom = (store: Storage): Attribution | null => {
  try {
    const raw = store.getItem(ATTRIBUTION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Lo guardado lo puede haber tocado cualquiera: se vuelve a recortar.
    return parsed && typeof parsed === "object" ? parseAttribution(parsed) : null;
  } catch {
    return null;
  }
};

const readStored = (): Attribution | null => {
  const found = stores()
    .map(readFrom)
    .filter((a): a is Attribution => a !== null);
  // Si uno de los dos tiene de dónde vino y el otro no, gana el que sí.
  return found.find(hasAttribution) ?? found[0] ?? memory;
};

const write = (attribution: Attribution): void => {
  memory = attribution;
  const raw = JSON.stringify(attribution);
  for (const store of stores()) {
    try {
      store.setItem(ATTRIBUTION_KEY, raw);
    } catch {
      /* lleno o bloqueado: queda en memoria */
    }
  }
};

/**
 * Al aterrizar: lee la URL y el referente y guarda el origen si es el primero
 * (o si el guardado no decía de dónde vino y este sí). Devuelve el que vale.
 */
export const captureAttribution = (): Attribution | null => {
  if (typeof window === "undefined") return null;
  let current: Attribution;
  try {
    current = attributionFromUrl(window.location.search, document.referrer || null, window.location.pathname);
  } catch {
    return readStored();
  }
  const stored = readStored();
  if (stored && hasAttribution(stored)) {
    // Se vuelve a escribir en los dos sitios: si uno se borró, se repone del otro.
    write(stored);
    return stored;
  }
  if (!stored || hasAttribution(current)) {
    write(current);
    return current;
  }
  return stored;
};

/** El origen guardado, para mandarlo con el formulario. */
export const storedAttribution = (): Attribution | null => {
  if (typeof window === "undefined") return null;
  return readStored() ?? captureAttribution();
};
