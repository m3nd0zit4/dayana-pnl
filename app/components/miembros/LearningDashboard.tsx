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
  /** Resumen corto del curso — sin él la tarjeta era solo un título y una barra. */
  description: string | null;
  imageUrl: string | null;
  moduleCount: number;
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
    <img src={imageUrl} alt="" className="size-full object-cover" />
  ) : (
    <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
      <GraduationCap className="size-10 text-primary/50" aria-hidden />
      <span className="sr-only">{title}</span>
    </div>
  );

/** Full-width row, not a grid tile — a grid with 1-2 items always reads as
 *  mostly empty space. Matches Coursera's actual "My Learning" list, which
 *  is rows, not a card mosaic, and scales the same whether there's 1 course
 *  or 20. */
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
      <CardContent className="flex flex-col gap-5 p-0 sm:flex-row sm:items-stretch">
        <div className="h-40 shrink-0 sm:h-auto sm:w-64">
          <CourseCover title={course.title} imageUrl={course.imageUrl} />
        </div>

        <div className="flex flex-1 flex-col gap-3 p-5 pt-0 sm:py-5 sm:pl-0">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {BRAND.name}
            </p>
            <h2 className="mt-0.5 text-lg leading-snug font-semibold text-balance">
              {course.title}
            </h2>
            {course.description && (
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {course.description}
              </p>
            )}
            {course.moduleCount > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {course.moduleCount} {course.moduleCount === 1 ? "módulo" : "módulos"}
                {course.totalClasses > 0 && ` · ${course.totalClasses} lecciones`}
              </p>
            )}
          </div>

          {course.totalClasses > 0 ? (
            <div className="max-w-sm">
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
            <Badge className="w-fit border-warning/40 bg-warning/10 text-warning">
              {course.neverPaid ? "Sin activar" : "Membresía vencida"}
            </Badge>
          )}

          <div className="mt-auto pt-1">
            <Button nativeButton={false} render={<Link href={href} />}>
              {cta}
            </Button>
          </div>
        </div>
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
        <div className="space-y-4">
          {visible.map((course) => (
            <CourseCard key={course.productId} course={course} />
          ))}
        </div>
      )}
    </div>
  );
};

export default LearningDashboard;
