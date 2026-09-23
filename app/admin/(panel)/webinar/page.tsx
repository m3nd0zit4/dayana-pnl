import { permanentRedirect } from "next/navigation";

/** «Webinar gratuito» ahora es «Eventos gratuitos». */
const Page = () => permanentRedirect("/admin/eventos");

export default Page;
