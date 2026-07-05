"use client";

import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CrmPageShell from "./CrmPageShell";
import CrmModal from "./CrmModal";
import CursoTabs from "./CursoTabs";
import { useCrm } from "./CrmProvider";

export type CourseModuleRow = {
  id: string;
  title: string;
  bodyMd: string | null;
  sortOrder: number;
  isPublished: boolean;
};

type Props = {
  preview: boolean;
  initialModules: CourseModuleRow[];
};

type EditorState = {
  id: string | null;
  title: string;
  bodyMd: string;
  isPublished: boolean;
  showPreview: boolean;
};

const CourseModulesPageClient = ({ preview, initialModules }: Props) => {
  const { canWrite, toast, confirm } = useCrm();
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

  const openEditor = (row?: CourseModuleRow) => {
    setEditor(
      row
        ? {
            id: row.id,
            title: row.title,
            bodyMd: row.bodyMd ?? "",
            isPublished: row.isPublished,
            showPreview: false,
          }
        : { id: null, title: "", bodyMd: "", isPublished: false, showPreview: false }
    );
  };

  const save = async () => {
    if (!editor) return;
    if (!editor.title.trim()) {
      toast("Falta el título", "error");
      return;
    }

    setSaving(true);
    const res = await fetch(
      editor.id ? `/api/admin/lms/modules/${editor.id}` : "/api/admin/lms/modules",
      {
        method: editor.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: editor.title.trim(),
          bodyMd: editor.bodyMd || null,
          isPublished: editor.isPublished,
        }),
      }
    );
    setSaving(false);

    if (!res.ok) {
      toast("No se pudo guardar el módulo", "error");
      return;
    }
    toast(editor.id ? "Módulo actualizado" : "Módulo creado");
    setEditor(null);
    void reload();
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
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="crm-section-title text-xl">Curso · Módulos</h1>
            <p className="crm-section-subtitle mt-1">
              El material que Dayana enviaba por WhatsApp, ahora en el portal.
              Acepta Markdown (negritas, listas, títulos). Solo los publicados
              son visibles para los miembros.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CursoTabs />
            {!preview && canWrite && (
              <button
                type="button"
                className="crm-btn-primary crm-btn-compact"
                onClick={() => openEditor()}
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">Nuevo módulo</span>
              </button>
            )}
          </div>
        </div>

        <div className="crm-surface-card overflow-hidden">
          <ul className="divide-y divide-[var(--crm-border)]">
            {rows.length === 0 && (
              <li className="p-8 text-center text-sm text-[var(--crm-muted)]">
                Sin módulos. Crea el primero con «Nuevo módulo».
              </li>
            )}
            {rows.map((row, index) => (
              <li key={row.id} className="crm-table-row p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-8 text-center text-xs font-semibold text-[var(--crm-muted)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="text-sm font-semibold">{row.title}</div>
                      <span
                        className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          row.isPublished
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-neutral-200 text-neutral-600"
                        }`}
                      >
                        {row.isPublished ? "Publicado" : "Borrador"}
                      </span>
                    </div>
                  </div>

                  {!preview && canWrite && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        className="crm-btn-icon size-8"
                        aria-label="Subir"
                        disabled={index === 0 || reordering}
                        onClick={() => void move(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="crm-btn-icon size-8"
                        aria-label="Bajar"
                        disabled={index === rows.length - 1 || reordering}
                        onClick={() => void move(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="crm-btn-secondary text-xs"
                        onClick={() => void togglePublished(row)}
                      >
                        {row.isPublished ? "Ocultar" : "Publicar"}
                      </button>
                      <button
                        type="button"
                        className="crm-btn-secondary text-xs"
                        onClick={() => openEditor(row)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="crm-btn-ghost text-xs"
                        onClick={() => remove(row)}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <CrmModal
        title={editor?.id ? "Editar módulo" : "Nuevo módulo"}
        open={!!editor}
        onClose={() => setEditor(null)}
        large
      >
        {editor && (
          <div className="space-y-4">
            <label className="block">
              <span className="crm-label">Título *</span>
              <input
                className="crm-input"
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                placeholder="Módulo 1 · Introducción a la PNL"
              />
            </label>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="crm-label mb-0">Contenido (Markdown)</span>
                <button
                  type="button"
                  className="crm-btn-ghost text-xs"
                  onClick={() =>
                    setEditor({ ...editor, showPreview: !editor.showPreview })
                  }
                >
                  {editor.showPreview ? "Editar" : "Vista previa"}
                </button>
              </div>
              {editor.showPreview ? (
                <div className="crm-surface-card max-h-[50vh] overflow-y-auto p-4 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {editor.bodyMd || "*Sin contenido*"}
                  </Markdown>
                </div>
              ) : (
                <textarea
                  className="crm-input min-h-[45vh] font-mono text-[13px]"
                  value={editor.bodyMd}
                  onChange={(e) =>
                    setEditor({ ...editor, bodyMd: e.target.value })
                  }
                  placeholder={"## Bienvenida\n\nEscribe aquí el contenido del módulo…"}
                />
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editor.isPublished}
                onChange={(e) =>
                  setEditor({ ...editor, isPublished: e.target.checked })
                }
              />
              Publicado (visible para miembros al día)
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="crm-btn-secondary"
                onClick={() => setEditor(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="crm-btn-primary"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        )}
      </CrmModal>
    </CrmPageShell>
  );
};

export default CourseModulesPageClient;
