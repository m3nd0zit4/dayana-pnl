import { redirect } from "next/navigation";
import { getCourseProduct } from "@/lib/lms/membership";

export const dynamic = "force-dynamic";

/** Folded into the course player — every class (live or recorded) now lives
 *  in its week's sidebar entry there instead of a separate flat schedule. */
const Page = async () => {
  const course = await getCourseProduct();
  redirect(course ? `/miembros/curso/${course.id}` : "/miembros");
};

export default Page;
