import { permanentRedirect } from "next/navigation";

/** El historial ahora es la pestaña «Pasados» de la lista de eventos. */
const Page = () => permanentRedirect("/admin/eventos?vista=pasados");

export default Page;
