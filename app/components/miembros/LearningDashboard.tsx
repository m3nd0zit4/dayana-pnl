"use client";

import Link from "next/link";
import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { BRAND } from "@/lib/contact";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";

export type CourseCardData = {
  productId: string;
  title: string;
  imageUrl: string | null;
  percent: number;
  completedClasses: number;
  totalClasses: number;
  nextIncompleteClassId: string | null;
  isCurrent: boolean;
  neverPaid: boolean;
};

type Tab = "progress" | "completed";

const CourseCover = ({ title, imageUrl }: { title: string; imageUrl: string | null }) =>
  imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary staff-provided URL, no next/image domain config for it
    <img src={imageUrl} alt="" className="aspect-video w-full object-cover" />
  ) : (
    <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
      <GraduationCap className="size-10 text-primary/50" aria-hidden />
      <span className="sr-only">{title}</span>
    </div>
  );

const CourseCard = ({ course }: { course: CourseCardData }) => {
  const isComplete = course.totalClasses > 0 && course.percent === 100;
  const started = course.completedClasses > 0;

  const href =
    !course.isCurrent
      ? "/servicios#curso"
      : course.nextIncompleteClassId
        ? `/miembros/curso/${course.productId}?c=${course.nextIncompleteClassId}`
        : `/miembros/curso/${course.productId}`;

  const cta = !course.isCurrent
    ? course.neverPaid
      ? "Activar acceso"
      : "Renovar"
    : isComplete
      ? "Ver curso"
      : started
        ? "Continuar"
        : "Empezar";

  return (
    <Card className="overflow-hidden py-0 transition-shadow hover:shadow-md">
      <CourseCover title={course.title} imageUrl={course.imageUrl} />
      <CardContent className="flex flex-1 flex-col gap-3 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
            {BRAND.name}
          </p>
          <h2 className="mt-0.5 line-clamp-2 text-base leading-snug font-semibold">
            {course.title}
          </h2>
        </div>

        {course.totalClasses > 0 ? (
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{course.percent}% completo</span>
              <span>
                {course.completedClasses}/{course.totalClasses} clases
              </span>
            </div>
            <Progress value={course.percent} className="mt-1.5" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">El contenido se publicará pronto.</p>
        )}

        {!course.isCurrent && (
          <Badge className="w-fit bg-amber-100 text-amber-700 dark:bg-amber-100 dark:text-amber-700">
            {course.neverPaid ? "Sin activar" : "Membresía vencida"}
          </Badge>
        )}

        <Button className="mt-1 w-full" nativeButton={false} render={<Link href={href} />}>
          {cta}
        </Button>
      </CardContent>
    </Card>
  );
};

const LearningDashboard = ({
  firstName,
  courses,
}: {
  firstName: string;
  courses: CourseCardData[];
}) => {
  const [tab, setTab] = useState<Tab>("progress");

  const completed = courses.filter((c) => c.totalClasses > 0 && c.percent === 100);
  const inProgress = courses.filter((c) => !(c.totalClasses > 0 && c.percent === 100));
  const visible = tab === "progress" ? inProgress : completed;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Hola, {firstName}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-3xl">
          Mi aprendizaje
        </h1>
      </div>

      <Tabs value={tab} onValueChange={(v) => typeof v === "string" && setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="progress">En progreso ({inProgress.length})</TabsTrigger>
          <TabsTrigger value="completed">Completados ({completed.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <GraduationCap className="size-8 text-muted-foreground/50" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {tab === "progress"
                ? "Todavía no tienes cursos en progreso — activa uno para empezar."
                : "Aún no has completado ningún curso — sigue avanzando y aparecerá aquí."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((course) => (
            <CourseCard key={course.productId} course={course} />
          ))}
        </div>
      )}
    </div>
  );
};

export default LearningDashboard;
