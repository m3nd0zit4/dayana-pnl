"use client";

import Link from "next/link";
import { MessageCircleOff } from "lucide-react";
import { useState } from "react";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmRowActions,
  CrmRowDelete,
} from "./ui";

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
      confirmLabel: "Eliminar",
      destructive: true,
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
      <CrmPageHeader
        title="Curso · Comentarios"
        description="Todo lo que los miembros preguntan o comentan en cada clase, en un solo lugar."
      />

      <CrmDataList>
        {preview || comments.length === 0 ? (
          <CrmEmptyState
            icon={MessageCircleOff}
            title="Sin comentarios todavía"
            description="Cuando alguien comente en una clase aparecerá aquí, con enlace a su módulo."
          />
        ) : (
          comments.map((row) => (
            <CrmDataListRow
              key={row.id}
              className="items-start"
              actions={
                <CrmRowActions>
                  <CrmRowDelete onClick={() => remove(row)} />
                </CrmRowActions>
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-semibold">{row.contactFirstName}</p>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </span>
                </div>
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
            </CrmDataListRow>
          ))
        )}
      </CrmDataList>
    </CrmPageShell>
  );
};

export default CourseCommentsPageClient;
