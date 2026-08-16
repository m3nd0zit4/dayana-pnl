/**
 * Plegado de texto para la búsqueda de contactos.
 *
 * **Gemelo de SQL.** `Contact.searchText` es una columna generada cuya
 * expresión vive en
 * `prisma/migrations/20260816120000_contact_search/migration.sql`. La consulta
 * tiene que plegar el término igual que la columna plegó los datos, o no
 * casará nunca. Si cambias uno de los dos mapas, cambia el otro en el mismo
 * commit.
 *
 * **No uses `.normalize("NFD")` aquí.** Es la forma idiomática en JS y sería
 * un error: pliega un conjunto de caracteres estrictamente mayor que el
 * `translate()` de Postgres. Un término con, por ejemplo, `ā` se plegaría en
 * el cliente pero no en la columna, y la búsqueda devolvería cero resultados
 * sin ningún error — el peor modo de fallo posible para un buscador.
 */

/** Idéntico al primer argumento del translate() en la migración. */
const FOLD_FROM = "áàäâãéèëêíìïîóòöôõúùüûñç";
/** Idéntico al segundo. Misma longitud, carácter a carácter. */
const FOLD_TO = "aaaaaeeeeiiiiooooouuuunc";

const FOLD_MAP = new Map<string, string>(
  [...FOLD_FROM].map((ch, i) => [ch, FOLD_TO[i]!])
);

/**
 * Minúsculas y sin tildes, exactamente como la columna `search_text`.
 *
 * Se minusculiza primero, igual que el SQL (`translate(lower(...)))`), así que
 * el mapa solo necesita las vocales minúsculas.
 */
export const foldForSearch = (value: string): string =>
  [...value.toLowerCase()].map((ch) => FOLD_MAP.get(ch) ?? ch).join("");

/**
 * Un trigrama necesita al menos 3 caracteres para poder usar el índice GIN.
 * Por debajo de eso Postgres cae a un scan; el buscador de la UI espera a
 * tener suficiente texto antes de consultar.
 */
export const MIN_SEARCH_TOKEN = 2;

/**
 * Tope de tokens por consulta. Cada token es una intersección GIN más, así que
 * un pegado accidental de un párrafo no debe convertirse en cuarenta.
 */
export const MAX_SEARCH_TOKENS = 6;
