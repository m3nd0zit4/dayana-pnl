import { redirect } from "next/navigation";

/**
 * `/admin/ajustes` aterriza en «Perfil» y no en «General» a propósito: perfil
 * lo ve cualquier rol, general es solo de OWNER. Mandar a general rebotaría a
 * todo el que no sea dueño nada más entrar.
 */
const Page = () => redirect("/admin/ajustes/perfil");

export default Page;
