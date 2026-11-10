/**
 * Páginas cuya dirección es un secreto de la persona (su enlace de la llamada
 * gratis, `/llamada/<token>`): quien tenga esa dirección ve su cita y puede
 * moverla o cancelarla. Por eso la dirección no se le manda a nadie: ni el
 * Pixel de Meta ni GTM se cargan ahí, y Vercel Analytics la recibe sin el
 * secreto.
 */
const PRIVATE = /^\/llamada\/[A-Za-z0-9_-]{24,}(?=\/|$)/;

export const isPrivatePath = (pathname: string | null | undefined): boolean => Boolean(pathname && PRIVATE.test(pathname));

/** La misma dirección sin el secreto, para la analítica. */
export const redactPrivateUrl = (url: string): string => url.replace(/(\/llamada\/)[A-Za-z0-9_-]{24,}/, "$1mi-llamada");
