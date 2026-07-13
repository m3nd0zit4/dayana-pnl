"use client";

import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GeneratedModuleContent } from "@/lib/ai/module-generation";
import { RECORDING_RETENTION_DAYS } from "@/lib/lms/course-content";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";
import ModuleAiGenerateBox from "./ModuleAiGenerateBox";
import ClassEditorModal, { type ClassEditorRow } from "./ClassEditorModal";

export type ModuleDetail = {
  id: string;
  title: string;
  bodyMd: string | null;
  isPublished: boolean;
};

export type ModuleClassRow = ClassEditorRow & {
  recordingPostedAt: string | null;
  recordingHiddenAt: string | null;
};

type UnassignedClass = { id: string; title: string; scheduledAt: string | null };

type Props = {
  preview: boolean;
  module: ModuleDetail;
  initialClasses: ModuleClassRow[];
};

const formatDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
    : "Sin fecha";

const recordingExpiry = (postedAt: string) => {
  const until = new Date(
    new Date(postedAt).getTime() + RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  return until.toLocaleDateString("es-CO", { dateStyle: "medium" });
};

const CourseModuleDetailClient = ({ preview, module: initialModule, initialClasses }: Props) => {
  const { canWrite, aiEnabled, toast, confirm } = useCrm();
  const [mod, setMod] = useState(initialModule);
  const [savingModule, setSavingModule] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [classes, setClasses] = useState<ModuleClassRow[]>(initialClasses);
  const [editing, setEditing] = useState<ClassEditorRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  const [unassigned, setUnassigned] = useState<UnassignedClass[]>([]);
  const [assignTarget, setAssignTarget] = useState("");
  const [assigning, setAssigning] = useState(false);

  const reload = useCallback(async () => {
    if (preview) return;
    const res = await fetch(`/api/admin/lms/classes?moduleId=${mod.id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { classes?: typeof classes };
    if (data.classes) setClasses(data.classes);
  }, [preview, mod.id]);

  const loadUnassigned = useCallback(async () => {
    if (preview) return;
    const res = await fetch("/api/admin/lms/classes?unassigned=1");
    if (!res.ok) return;
    const data = (await res.json()) as { classes?: UnassignedClass[] };
    setUnassigned(data.classes ?? []);
  }, [preview]);

  useEffect(() => {
    void loadUnassigned();
  }, [loadUnassigned]);

  const applyAiContent = (content: GeneratedModuleContent) => {
    setMod((m) => ({
      ...m,
      title: m.title.trim() ? m.title : content.title,
      bodyMd: content.bodyMd,
    }));
    setShowPreview(false);
  };

  const saveModule = async () => {
    if (!mod.title.trim()) {
      toast("Falta el título", "error");
      return;
    }
    setSavingModule(true);
    const res = await fetch(`/api/admin/lms/modules/${mod.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: mod.title.trim(),
        bodyMd: mod.bodyMd || null,
        isPublished: mod.isPublished,
      }),
    });
    setSavingModule(false);
    if (!res.ok) {
      toast("No se pudo guardar el módulo", "error");
      return;
    }
    toast("Módulo actualizado");
  };

  const openNewClass = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEditClass = (row: ClassEditorRow) => {
    setEditing(row);
    setEditorOpen(true);
  };
  const onClassSaved = () => {
    setEditorOpen(false);
    void reload();
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= classes.length) return;
    const next = [...classes];
    [next[index], next[target]] = [next[target], next[index]];
    setClasses(next);
    setReordering(true);
    const res = await fetch("/api/admin/lms/classes/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moduleId: mod.id, orderedIds: next.map((c) => c.id) }),
    });
    setReordering(false);
    if (!res.ok) {
      toast("No se pudo reordenar", "error");
      void reload();
    }
  };

  const removeClass = (row: ClassEditorRow) => {
    confirm({
      title: "Eliminar clase",
      message: `¿Eliminar «${row.title}»? Los miembros dejarán de ver su grabación.`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/lms/classes/${row.id}`, { method: "DELETE" });
        if (!res.ok) {
          toast("No se pudo eliminar", "error");
          return;
        }
        toast("Clase eliminada");
        void reload();
      },
    });
  };

  const unassignClass = (row: ClassEditorRow) => {
    confirm({
      title: "Quitar del módulo",
      message: `«${row.title}» pasará a no asignada — dejará de verse en este módulo hasta que la asignes de nuevo.`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/lms/classes/${row.id}/assign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ moduleId: null }),
        });
        if (!res.ok) {
          toast("No se pudo quitar", "error");
          return;
        }
        toast("Clase movida a no asignadas");
        void reload();
        void loadUnassigned();
      },
    });
  };

  const notifyRecording = (row: ClassEditorRow) => {
    confirm({
      title: "Notificar grabación",
      message: `Se avisará por correo y WhatsApp a los miembros al día que la grabación de «${row.title}» está disponible.`,
      onConfirm: async () => {
        setNotifyingId(row.id);
        const res = await fetch(`/api/admin/lms/classes/${row.id}/notify`, { method: "POST" });
        setNotifyingId(null);
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast(
            data?.error === "forbidden"
              ? "Solo la propietaria puede enviar avisos masivos"
              : "No se pudo notificar",
            "error"
          );
          return;
        }
        const data = (await res.json()) as { targets: number; sent: number };
        toast(`Aviso enviado (${data.sent} envíos a ${data.targets} miembros)`);
      },
    });
  };

  const assignExisting = async () => {
    if (!assignTarget) return;
    setAssigning(true);
    const res = await fetch(`/api/admin/lms/classes/${assignTarget}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moduleId: mod.id }),
    });
    setAssigning(false);
    if (!res.ok) {
      toast("No se pudo asignar", "error");
      return;
    }
    toast("Clase asignada al módulo");
    setAssignTarget("");
    void reload();
    void loadUnassigned();
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <Link
          href="/admin/curso/modulos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Módulos
        </Link>

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título del módulo *</Label>
              <Input
                value={mod.title}
                onChange={(e) => setMod((m) => ({ ...m, title: e.target.value }))}
                placeholder="Módulo 1 · Introducción a la PNL"
                disabled={!canWrite || preview}
              />
            </div>

            {aiEnabled && <ModuleAiGenerateBox onGenerated={applyAiContent} />}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label className="mb-0">Descripción / resumen (Markdown, opcional)</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? "Editar" : "Vista previa"}
                </Button>
              </div>
              {showPreview ? (
                <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-card p-4 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc">
                  <Markdown remarkPlugins={[remarkGfm]}>{mod.bodyMd || "*Sin contenido*"}</Markdown>
                </div>
              ) : (
                <Textarea
                  className="min-h-[20vh] font-mono text-[13px]"
                  value={mod.bodyMd ?? ""}
                  onChange={(e) => setMod((m) => ({ ...m, bodyMd: e.target.value }))}
                  placeholder="Introducción u overview de la semana (opcional) — las clases de abajo son el contenido principal."
                  disabled={!canWrite || preview}
                />
              )}
            </div>

            {canWrite && !preview && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={mod.isPublished}
                  onCheckedChange={(checked) =>
                    setMod((m) => ({ ...m, isPublished: checked === true }))
                  }
                />
                Publicado (visible para miembros al día)
              </label>
            )}

            {canWrite && !preview && (
              <div className="flex justify-end">
                <Button disabled={savingModule} onClick={() => void saveModule()}>
                  {savingModule ? "Guardando…" : "Guardar módulo"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Clases de este módulo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              El orden aquí es el orden que ven los miembros en el reproductor del curso.
            </p>
          </div>
          {!preview && canWrite && (
            <Button size="sm" onClick={openNewClass}>
              <Plus />
              <span className="hidden sm:inline">Nueva clase</span>
            </Button>
          )}
        </div>

        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {classes.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Sin clases todavía. Crea una nueva o asigna una ya existente abajo.
              </div>
            )}
            {classes.map((row, index) => (
              <div key={row.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">
                      {index + 1}. {row.title}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(row.scheduledAt)}
                      {row.meetUrl ? " · Meet configurado" : " · Sin enlace Meet"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs">
                      <Video className="size-3.5 text-muted-foreground" aria-hidden />
                      {row.recordingUrl ? (
                        row.recordingHiddenAt ? (
                          <span className="text-muted-foreground">Grabación oculta (venció el mes)</span>
                        ) : row.recordingPostedAt ? (
                          <span className="text-emerald-700">
                            Grabación visible hasta el {recordingExpiry(row.recordingPostedAt)}
                          </span>
                        ) : (
                          <span className="text-emerald-700">Grabación publicada</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">Sin grabación</span>
                      )}
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
                        disabled={index === classes.length - 1 || reordering}
                        onClick={() => void move(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      {row.recordingUrl && !row.recordingHiddenAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={notifyingId === row.id}
                          onClick={() => notifyRecording(row)}
                        >
                          {notifyingId === row.id ? "Notificando…" : "Notificar grabación"}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => openEditClass(row)}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => unassignClass(row)}>
                        Quitar del módulo
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => removeClass(row)}>
                        Eliminar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {!preview && canWrite && unassigned.length > 0 && (
          <Card>
            <CardContent className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Asignar clase existente</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Clases creadas antes de que existieran los módulos, o quitadas de otro módulo.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                  <SearchableSelect
                    label="Clase sin asignar"
                    hideLabel
                    value={assignTarget}
                    onChange={setAssignTarget}
                    options={unassigned.map((c) => ({
                      value: c.id,
                      label: c.title,
                      hint: formatDateTime(c.scheduledAt),
                    }))}
                    placeholder="Buscar clase sin asignar…"
                  />
                </div>
                <Button disabled={!assignTarget || assigning} onClick={() => void assignExisting()}>
                  {assigning ? "Asignando…" : "Asignar a este módulo"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <ClassEditorModal
        moduleId={mod.id}
        open={editorOpen}
        editingRow={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={onClassSaved}
      />
    </CrmPageShell>
  );
};

export default CourseModuleDetailClient;
