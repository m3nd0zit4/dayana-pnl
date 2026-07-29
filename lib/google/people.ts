import { throwGoogleApiError } from "./api-error";

/**
 * Google People (Contactos), solo lectura.
 *
 * `contacts.readonly` deja buscar y leer, nunca escribir: importar a un
 * contacto del CRM se hace con nuestras propias tablas, así que no hace falta
 * pedir permiso de escritura sobre la agenda personal de nadie.
 */

const PEOPLE_BASE = "https://people.googleapis.com/v1";

const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,photos,organizations";

export type GooglePerson = {
  resourceName: string;
  name: string | null;
  emails: string[];
  phones: string[];
  photoUrl: string | null;
  organization: string | null;
};

type RawPerson = {
  resourceName?: string;
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string; canonicalForm?: string }[];
  photos?: { url?: string; default?: boolean }[];
  organizations?: { name?: string }[];
};

const normalize = (person: RawPerson): GooglePerson => ({
  resourceName: person.resourceName ?? "",
  name: person.names?.[0]?.displayName ?? null,
  emails: (person.emailAddresses ?? [])
    .map((e) => e.value)
    .filter((v): v is string => Boolean(v)),
  // `canonicalForm` ya viene en E.164 cuando Google puede resolverlo, que es lo
  // que el CRM guarda; el `value` crudo es lo que tecleó la persona.
  phones: (person.phoneNumbers ?? [])
    .map((p) => p.canonicalForm ?? p.value)
    .filter((v): v is string => Boolean(v)),
  // La foto por defecto es el avatar genérico de Google, no una foto real.
  photoUrl: person.photos?.find((p) => !p.default)?.url ?? null,
  organization: person.organizations?.[0]?.name ?? null,
});

const request = async <T>(token: string, path: string): Promise<T> => {
  const res = await fetch(`${PEOPLE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) await throwGoogleApiError("people", res);

  return (await res.json()) as T;
};

/**
 * Busca en los contactos de la cuenta.
 *
 * El índice de búsqueda de People se construye por sesión: la primera llamada
 * con una consulta nueva puede devolver vacío aunque el contacto exista. Google
 * documenta "calentarlo" con una petición de consulta vacía, que es justo lo
 * que hace `warmSearchCache`.
 */
export const searchContacts = async (
  token: string,
  query: string,
  pageSize = 20
): Promise<GooglePerson[]> => {
  const params = new URLSearchParams({
    query,
    pageSize: String(pageSize),
    readMask: PERSON_FIELDS,
  });
  const data = await request<{ results?: { person?: RawPerson }[] }>(
    token,
    `/people:searchContacts?${params}`
  );
  return (data.results ?? [])
    .map((r) => r.person)
    .filter((p): p is RawPerson => Boolean(p))
    .map(normalize);
};

/** Calienta el índice de búsqueda; se ignora el resultado a propósito. */
export const warmSearchCache = async (token: string): Promise<void> => {
  const params = new URLSearchParams({ query: "", readMask: PERSON_FIELDS });
  await request(token, `/people:searchContacts?${params}`).catch(() => undefined);
};

export const getPerson = async (
  token: string,
  resourceName: string
): Promise<GooglePerson> => {
  const params = new URLSearchParams({ personFields: PERSON_FIELDS });
  const raw = await request<RawPerson>(
    token,
    `/${resourceName}?${params}`
  );
  return normalize(raw);
};
