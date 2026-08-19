import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Superseded by the course player's week/module sidebar. With a library of
 *  courses there is no single "the modules" page to land on — the dashboard
 *  lists the courses the member has access to. */
const Page = async () => {
  redirect("/miembros");
};

export default Page;
