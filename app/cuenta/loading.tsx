/**
 * Lo que se ve mientras carga una pestaña de la cuenta.
 *
 * Sin esto, cambiar entre Perfil, Seguridad, Avisos y Pagos dejaba la pantalla
 * congelada hasta que el servidor respondía: las páginas son dinámicas —datos
 * personales, nada cacheable— así que siempre hay una ida y vuelta, y sin
 * estado intermedio esa espera se lee como una recarga entera de la página.
 *
 * Sólo cubre el área de contenido: la cabecera y las pestañas viven en el
 * layout, así que se quedan quietas y sólo cambia lo de dentro. Eso es
 * exactamente lo que hace que la navegación se sienta instantánea.
 */
const CuentaLoading = () => (
  <div
    className="mt-10 space-y-10"
    aria-busy="true"
    aria-label="Cargando tu cuenta"
  >
    {[0, 1].map((section) => (
      <section key={section} className="space-y-4">
        <div className="h-3 w-32 animate-pulse rounded bg-black/[0.07]" />
        <div className="space-y-3 rounded-2xl border border-black/10 p-6">
          <div className="h-4 w-2/5 animate-pulse rounded bg-black/[0.07]" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-black/[0.05]" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-black/[0.07]" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-black/[0.05]" />
        </div>
      </section>
    ))}
  </div>
);

export default CuentaLoading;
