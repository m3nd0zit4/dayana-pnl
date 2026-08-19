import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Folded into the course player — every class (live or recorded) now lives
 *  in its week's sidebar entry there instead of a separate flat schedule.
 *  With several courses the entry point is the dashboard, not one course. */
const Page = async () => {
  redirect("/miembros");
};

export default Page;
