/**
 * El enlace secreto de quien ya dejó sus datos en `/llamada`, guardado en el
 * navegador para que al volver encuentre su página (`/llamada/<token>`).
 * Puede estar viejo (otra persona en el mismo celular, un registro borrado):
 * por eso solo se ofrece como enlace y nunca se redirige solo.
 */

export const TOKEN_KEY = "dayana_llamada_token";

const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

/** `null` si no hay ninguno, si no tiene forma de enlace o si el navegador no deja leer. */
export const readStoredToken = (): string | null => {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw && TOKEN.test(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const saveStoredToken = (token: string): void => {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* modo privado o almacenamiento lleno: la persona sigue con el enlace en pantalla */
  }
};
