import { redirect } from "next/navigation";

/** Los ajustes del asistente viven ahora en la sección de WhatsApp. */
const Page = () => redirect("/admin/whatsapp/ajustes");

export default Page;
