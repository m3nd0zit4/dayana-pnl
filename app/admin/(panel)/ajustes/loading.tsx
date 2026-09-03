/**
 * Lo que se ve mientras carga una pestaña de Ajustes.
 *
 * Sin esto, saltar entre Perfil, Seguridad y las demás dejaba la pantalla
 * quieta hasta que el servidor respondía. Las páginas son dinámicas —leen la
 * sesión del staff— así que siempre hay una ida y vuelta, y sin nada que
 * enseñar mientras tanto esa pausa se lee como si la página entera se
 * recargara.
 *
 * Cubre sólo la columna de contenido: la cabecera «Ajustes» y el menú lateral
 * viven en el layout y se quedan fijos. Eso es justo lo que hace que el salto
 * entre pestañas se sienta instantáneo en vez de un refresco.
 */
const AjustesLoading = () => (
  <div className="space-y-6" aria-busy="true" aria-label="Cargando ajustes">
    <div className="rounded-xl border border-border p-5">
      <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      <div className="mt-5 space-y-4">
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        <div className="h-9 w-full max-w-md animate-pulse rounded-md bg-muted/70" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-9 w-56 animate-pulse rounded-md bg-muted/70" />
        <div className="h-9 w-36 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  </div>
);

export default AjustesLoading;
