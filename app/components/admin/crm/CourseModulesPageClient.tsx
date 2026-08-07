"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Layers, MessageCircle } from "lucide-react";
import { useCallback, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";
import { CrmEmptyState, CrmFormActions } from "./ui";

export type CourseModuleRow = {
  id: string;
  title: string;
  bodyMd: string | null;
  sortOrder: number;
  isPublished: boolean;
  classCount: number;
  commentCount: number;
};

type Props = {
  preview: boolean;
  initialModules: CourseModuleRow[];
};

/** Create-only — editing an existing module (title/content/published) lives
 *  on the detail page, not here. This modal used to also support editing an
 *  existing row, but no button ever opened it that way; removed as dead code. */
type EditorState = {
  title: string;
  bodyMd: string;
  isPublished: boolean;
  showPreview: boolean;
};

const CourseModulesPageClient = ({ preview, initialModules }: Props) => {
  const { canWrite, toast, confirm } = useCrm();
  const router = useRouter();
  const [rows, setRows] = useState<CourseModuleRow[]>(initialModules);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);

  const reload = useCallback(async () => {
    if (preview) return;
    const res = await fetch("/api/admin/lms/modules");
    if (!res.ok) return;
    const data = (await res.json()) as { modules?: CourseModuleRow[] };
    if (data.modules) setRows(data.modules);
  }, [preview]);

  const openEditor = () => {
    setEditor({ title: "", bodyMd: "", isPublished: false, showPreview: false });
  };

  const save = async () => {
    if (!editor) return;
    if (!editor.title.trim()) {
      toast("Falta el título", "error");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/admin/lms/modules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: editor.title.trim(),
        bodyMd: editor.bodyMd || null,
        isPublished: editor.isPublished,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      toast("No se pudo guardar el módulo", "error");
      return;
    }
    const data = (await res.json()) as { module?: { id: string } };
    toast("Módulo creado");
    setEditor(null);
    if (data.module?.id) {
      router.push(`/admin/curso/modulos/${data.module.id}`);
    } else {
      void reload();
    }
  };

  const togglePublished = async (row: CourseModuleRow) => {
    const res = await fetch(`/api/admin/lms/modules/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublished: !row.isPublished }),
    });
    if (!res.ok) {
      toast("No se pudo cambiar la publicación", "error");
      return;
    }
    toast(!row.isPublished ? "Módulo publicado" : "Módulo ocultado");
    void reload();
  };

  const remove = (row: CourseModuleRow) => {
    confirm({
      title: "Eliminar módulo",
      message: `¿Eliminar «${row.title}»? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/lms/modules/${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          toast("No se pudo eliminar", "error");
          return;
        }
        toast("Módulo eliminado");
        void reload();
      },
    });
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    setReordering(true);
    const res = await fetch("/api/admin/lms/modules/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((m) => m.id) }),
    });
    setReordering(false);
    if (!res.ok) {
      toast("No se pudo reordenar", "error");
      void reload();
    }
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Curso · Módulos"
        description="El material que Dayana enviaba por WhatsApp, ahora en el portal. Acepta Markdown (negritas, listas, títulos). Solo los publicados son visibles para los miembros."
        action={
          !preview && canWrite ? (
            <CrmNewButton label="Nuevo módulo" onClick={() => openEditor()} />
          ) : undefined
        }
      />

      <div className="space-y-6">
        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {rows.length === 0 && (
              <CrmEmptyState
                icon={Layers}
                title="Sin módulos"
                description="Crea el primero para empezar a montar el temario del curso."
              />
            )}
            {rows.map((row, index) => (
              <div key={row.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-8 text-center text-xs font-semibold text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="text-sm font-semibold">{row.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge
                          className={
                            row.isPublished
                              ? "border-success/40 bg-success/10 text-success"
                              : "border-border bg-muted text-muted-foreground"
                          }
                        >
                          {row.isPublished ? "Publicado" : "Borrador"}
                        </Badge>
                        <Badge variant="secondary">
                          {row.classCount} {row.classCount === 1 ? "clase" : "clases"}
                        </Badge>
                        {row.commentCount > 0 && (
                          <Badge variant="secondary" className="gap-1">
                            <MessageCircle className="size-3" aria-hidden />
                            {row.commentCount}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {!preview && canWrite && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Subir"
                        disabled={index === 0 || reordering}
                        onClick={() => void move(index, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Bajar"
                        disabled={index === rows.length - 1 || reordering}
                        onClick={() => void move(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void togglePublished(row)}
                      >
                        {row.isPublished ? "Ocultar" : "Publicar"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/admin/curso/modulos/${row.id}`} />}
                      >
                        Gestionar clases
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(row)}>
                        Eliminar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <CrmModal
        title="Nuevo módulo"
        open={!!editor}
        onClose={() => setEditor(null)}
        large
      >
        {editor && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                placeholder="Módulo 1 · Introducción a la PNL"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label className="mb-0">Contenido (Markdown)</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setEditor({ ...editor, showPreview: !editor.showPreview })
                  }
                >
                  {editor.showPreview ? "Editar" : "Vista previa"}
                </Button>
              </div>
              {editor.showPreview ? (
                <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-card p-4 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {editor.bodyMd || "*Sin contenido*"}
                  </Markdown>
                </div>
              ) : (
                <Textarea
                  className="min-h-[45vh] font-mono text-[13px]"
                  value={editor.bodyMd}
                  onChange={(e) =>
                    setEditor({ ...editor, bodyMd: e.target.value })
                  }
                  placeholder={"## Bienvenida\n\nEscribe aquí el contenido del módulo…"}
                />
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={editor.isPublished}
                onCheckedChange={(checked) =>
                  setEditor({ ...editor, isPublished: checked === true })
                }
              />
              Publicado (visible para miembros al día)
            </label>

            <CrmFormActions size="sm">
              <Button variant="outline" onClick={() => setEditor(null)}>
                Cancelar
              </Button>
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </CrmFormActions>
          </div>
        )}
      </CrmModal>
    </CrmPageShell>
  );
};

export default CourseModulesPageClient;
