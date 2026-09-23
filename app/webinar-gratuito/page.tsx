import { permanentRedirect } from "next/navigation";
import { FREE_EVENT_PATH } from "@/lib/crm/free-webinar-publish";

/**
 * La dirección de antes. Sigue en la bio, en correos ya enviados y en
 * publicaciones: redirige para que ninguno de esos enlaces se rompa.
 */
const Page = () => permanentRedirect(FREE_EVENT_PATH);

export default Page;
