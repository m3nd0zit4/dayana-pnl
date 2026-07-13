"use client";

import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/lib/contact";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";

export type CourseCardData = {
  productId: string;
  title: string;
  percent: number;
  completedClasses: number;
  totalClasses: number;
  nextIncompleteClassId: string | null;
  isCurrent: boolean;
  neverPaid: boolean;
};

type Tab = "progress" | "completed";

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
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
            {BRAND.name}
          </p>
          <h2 className="mt-0.5 truncate text-base font-semibold">{course.title}</h2>
          {course.totalClasses > 0 ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {course.percent}% completo · {course.completedClasses}/{course.totalClasses}{" "}
                clases
              </p>
              <Progress value={course.percent} className="mt-2 max-w-xs" />
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              El contenido se publicará pronto.
            </p>
          )}
          {!course.isCurrent && (
            <Badge className="mt-2 bg-amber-100 text-amber-700 dark:bg-amber-100 dark:text-amber-700">
              {course.neverPaid ? "Sin activar" : "Membresía vencida"}
            </Badge>
          )}
        </div>
        <Button nativeButton={false} render={<Link href={href} />}>
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
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tab === "progress"
              ? "No tienes cursos en progreso todavía."
              : "Aún no has completado ningún curso."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((course) => (
            <CourseCard key={course.productId} course={course} />
          ))}
        </div>
      )}
    </div>
  );
};

export default LearningDashboard;
