import { redirect } from "next/navigation";

/**
 * `/admin/mi-cuenta` se fusionó con `/admin/ajustes`: había dos árboles de
 * configuración sin enlazar. Solo queda el reenvío para no romper enlaces
 * guardados.
 */
const Page = () => redirect("/admin/ajustes/perfil");

export default Page;
