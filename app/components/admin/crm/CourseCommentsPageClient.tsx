"use client";

import Link from "next/link";
import { MessageCircleOff } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";

export type CourseCommentRow = {
  id: string;
  body: string;
  createdAt: string;
  contactFirstName: string;
  classId: string;
  classTitle: string;
  moduleId: string | null;
  moduleTitle: string | null;
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

type Props = {
  preview: boolean;
  initialComments: CourseCommentRow[];
};

const CourseCommentsPageClient = ({ preview, initialComments }: Props) => {
  const { confirm, toast } = useCrm();
  const [comments, setComments] = useState<CourseCommentRow[]>(initialComments);

  const remove = (row: CourseCommentRow) => {
    confirm({
      title: "Eliminar comentario",
      message: `¿Eliminar el comentario de ${row.contactFirstName}? No se puede deshacer.`,
      onConfirm: async () => {
        const res = await fetch(
          `/api/admin/lms/classes/${row.classId}/comments/${row.id}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          toast("No se pudo eliminar", "error");
          return;
        }
        setComments((prev) => prev.filter((c) => c.id !== row.id));
        toast("Comentario eliminado");
      },
    });
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Curso · Comentarios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Todo lo que los miembros preguntan o comentan en cada clase, en un solo lugar.
          </p>
        </div>

        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {preview || comments.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <MessageCircleOff className="size-8 text-muted-foreground/50" aria-hidden />
                <p className="text-sm text-muted-foreground">Sin comentarios todavía.</p>
              </div>
            ) : (
              comments.map((row) => (
                <div key={row.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{row.contactFirstName}</p>
                      {row.moduleId ? (
                        <Link
                          href={`/admin/curso/modulos/${row.moduleId}`}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {row.moduleTitle ? `${row.moduleTitle} · ` : ""}
                          {row.classTitle}
                        </Link>
                      ) : (
                        <p className="text-xs text-muted-foreground">{row.classTitle}</p>
                      )}
                      <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap">
                        {row.body}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        className="text-xs text-destructive hover:underline"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </CrmPageShell>
  );
};

export default CourseCommentsPageClient;
