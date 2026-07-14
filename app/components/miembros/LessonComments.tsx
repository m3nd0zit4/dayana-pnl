"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageCircle, MessageCircleOff, Trash2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Textarea } from "@/app/components/ui/textarea";

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  contactId: string;
  contactFirstName: string;
};

const rtf = new Intl.RelativeTimeFormat("es-CO", { numeric: "auto" });

const relativeTime = (iso: string): string => {
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, "day");
};

const LessonComments = ({
  classId,
  viewerContactId,
}: {
  classId: string;
  viewerContactId: string;
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/miembros/classes/${classId}/comments`)
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
  }, [classId]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    const res = await fetch(`/api/miembros/classes/${classId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setPosting(false);
    if (!res.ok) {
      toast.error("No se pudo publicar el comentario. Intenta de nuevo.");
      return;
    }
    const data = (await res.json()) as { comment: Comment };
    setComments((prev) => [...prev, data.comment]);
    setDraft("");
  };

  const remove = async (commentId: string) => {
    const prev = comments;
    setComments((c) => c.filter((cm) => cm.id !== commentId));
    const res = await fetch(`/api/miembros/classes/${classId}/comments/${commentId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setComments(prev);
      toast.error("No se pudo eliminar el comentario.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">
          Comentarios{comments.length > 0 ? ` (${comments.length})` : ""}
        </h3>
      </div>

      <Card>
        <CardContent className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escribe una pregunta o comentario sobre esta clase…"
            className="min-h-20"
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={!draft.trim() || posting} onClick={() => void submit()}>
              {posting ? "Publicando…" : "Publicar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando comentarios…</p>
      ) : comments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <MessageCircleOff className="size-6 text-muted-foreground/60" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Aún no hay comentarios — sé el primero en preguntar algo sobre esta clase.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-lg border border-border p-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                {c.contactFirstName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{c.contactFirstName}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(c.createdAt)}
                    </span>
                    {c.contactId === viewerContactId && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void remove(c.id)}
                        aria-label="Eliminar comentario"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LessonComments;
