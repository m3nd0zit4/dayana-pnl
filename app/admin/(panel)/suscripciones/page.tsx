import { redirect } from "next/navigation";

/**
 * «Suscripciones» vive ahora en Membresías, pestaña Planes. La ruta se queda
 * como redirección para que ningún enlace guardado ni notificación ya enviada
 * lleve a un 404.
 */
const SuscripcionesPage = () => redirect("/admin/membresias?tab=planes");

export default SuscripcionesPage;
