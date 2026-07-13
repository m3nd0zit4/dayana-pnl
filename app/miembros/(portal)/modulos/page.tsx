import { redirect } from "next/navigation";
import { getCourseProduct } from "@/lib/lms/membership";

export const dynamic = "force-dynamic";

/** Superseded by the course player's week/module sidebar. */
const Page = async () => {
  const course = await getCourseProduct();
  redirect(course ? `/miembros/curso/${course.id}` : "/miembros");
};

export default Page;
