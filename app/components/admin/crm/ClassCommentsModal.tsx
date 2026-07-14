"use client";

import { useEffect, useState } from "react";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  contactId: string;
  contactFirstName: string;
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

type Props = {
  open: boolean;
  classId: string | null;
  classTitle: string;
  onClose: () => void;
};

const ClassCommentsModal = ({ open, classId, classTitle, onClose }: Props) => {
  const { confirm, toast } = useCrm();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !classId) return;
    let cancelled = false;
    fetch(`/api/admin/lms/classes/${classId}/comments`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d: { comments?: Comment[] }) => {
        if (!cancelled) setComments(d.comments ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, classId]);

  const remove = (comment: Comment) => {
    confirm({
      title: "Eliminar comentario",
      message: `¿Eliminar el comentario de ${comment.contactFirstName}? No se puede deshacer.`,
      onConfirm: async () => {
        const res = await fetch(
          `/api/admin/lms/classes/${classId}/comments/${comment.id}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          toast("No se pudo eliminar", "error");
          return;
        }
        setComments((prev) => prev.filter((c) => c.id !== comment.id));
        toast("Comentario eliminado");
      },
    });
  };

  return (
    <CrmModal title={`Comentarios — ${classTitle}`} open={open} onClose={onClose}>
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin comentarios todavía.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{c.contactFirstName}</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(c.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    className="text-xs text-destructive hover:underline"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{c.body}</p>
            </div>
          ))
        )}
      </div>
    </CrmModal>
  );
};

export default ClassCommentsModal;
