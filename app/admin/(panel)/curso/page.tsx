import { redirect } from "next/navigation";

/**
 * «Miembros» vive ahora en Membresías, pestaña Personas. La ruta se queda como
 * redirección para que no se rompa ningún enlace guardado ni ninguna
 * notificación ya enviada que apunte aquí.
 *
 * Sólo la raíz: `/admin/curso/modulos` y `/admin/curso/comentarios` siguen
 * siendo las pantallas del contenido del curso.
 */
const CursoPage = () => redirect("/admin/membresias");

export default CursoPage;
