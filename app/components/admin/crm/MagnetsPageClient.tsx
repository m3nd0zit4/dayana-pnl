"use client";

import { Copy, MessageCircle, Sparkles, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmModal from "./CrmModal";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmField,
  CrmFormActions,
  CrmRowAction,
  CrmRowActions,
  CrmRowDelete,
} from "./ui";

export type MagnetRow = {
  id: string;
  keyword: string;
  label: string;
  title: string;
  description: string | null;
  deliveryUrl: string;
  replyText: string | null;
  dmText: string | null;
  isActive: boolean;
  createdAt: string;
  claimCount: number;
  claimCount7d: number;
};

type Props = {
  preview: boolean;
  initialMagnets: MagnetRow[];
  siteUrl: string;
};

const emptyForm = () => ({
  id: "",
  keyword: "",
  label: "",
  title: "",
  description: "",
  deliveryUrl: "",
  replyText: "",
  dmText: "",
  isActive: true,
});

const ERRORS: Record<string, string> = {
  keyword_taken: "Esa palabra ya la usa otro material.",
  invalid_keyword: "La palabra solo puede tener letras y números.",
  invalid_url: "El enlace tiene que empezar por https:// o ser un archivo subido aquí.",
  invalid_body: "Falta algo: revisa la palabra, el título y el enlace.",
  file_too_large: "El archivo pesa demasiado (máximo 25 MB).",
  invalid_mime: "Formato no admitido: sube un PDF, una imagen o un audio.",
};

/**
 * Palabras clave de redes: «comenta ÉXITO y te mando el material».
 *
 * Lo que esta pantalla NO hace, y no puede hacer: responder sola el comentario
 * o el mensaje directo. TikTok no tiene API para ninguno de los dos en una
 * cuenta normal. Lo que hace es dejar la respuesta escrita y lista para pegar,
 * con su enlace dentro, y automatizar todo lo que viene después — entrega,
 * correo y ficha del lead en el CRM.
 */
const MagnetsPageClient = ({ preview, initialMagnets, siteUrl }: Props) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [magnets, setMagnets] = useState<MagnetRow[]>(initialMagnets);
  const [editing, setEditing] = useState<null | ReturnType<typeof emptyForm>>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const publicUrl = (keyword: string) => `${siteUrl}/material/${keyword}`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copiado`, "success");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  const reload = async () => {
    const res = await fetch("/api/admin/magnets");
    const data = (await res.json().catch(() => ({}))) as { magnets?: MagnetRow[] };
    if (data.magnets) setMagnets(data.magnets);
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/material/upload", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        setError(ERRORS[data.error ?? ""] ?? "No se pudo subir el archivo.");
        return;
      }
      setEditing((f) => (f ? { ...f, deliveryUrl: data.url! } : f));
      toast("Archivo subido", "success");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setError(null);
    setSaving(true);
    try {
      const payload = {
        keyword: editing.keyword.trim(),
        label: editing.label.trim() || editing.keyword.trim(),
        title: editing.title.trim(),
        description: editing.description.trim() || null,
        deliveryUrl: editing.deliveryUrl.trim(),
        replyText: editing.replyText.trim() || null,
        dmText: editing.dmText.trim() || null,
        isActive: editing.isActive,
      };
      const res = await fetch(
        editing.id ? `/api/admin/magnets/${editing.id}` : "/api/admin/magnets",
        {
          method: editing.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(ERRORS[data.error ?? ""] ?? "No se pudo guardar.");
        return;
      }
      await reload();
      setEditing(null);
      toast(editing.id ? "Material actualizado" : "Material creado", "success");
    } finally {
      setSaving(false);
    }
  };

  const remove = (row: MagnetRow) => {
    confirm({
      title: "Borrar la palabra",
      message: `«${row.label}» dejará de entregar nada y su página responderá 404. Las fichas de quienes ya lo pidieron se quedan en Contactos.`,
      confirmLabel: "Borrar",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/magnets/${row.id}`, { method: "DELETE" });
        if (!res.ok) {
          toast("No se pudo borrar", "error");
          return;
        }
        setMagnets((prev) => prev.filter((m) => m.id !== row.id));
        toast("Palabra borrada", "success");
      },
    });
  };

  /** Lo que se pega en el comentario, con el enlace ya dentro. */
  const replyFor = (row: MagnetRow) =>
    (row.replyText?.trim() || `¡Listo! Aquí está tu material 👇`) +
    `\n${publicUrl(row.keyword)}`;

  const dmFor = (row: MagnetRow) =>
    (row.dmText?.trim() || row.replyText?.trim() || `Aquí está lo que te prometí 👇`) +
    `\n${publicUrl(row.keyword)}`;

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Palabras clave"
        description="«Comenta ÉXITO y te mando el material». Tú pegas la respuesta; la entrega, el correo y el lead son automáticos."
        action={
          canManageTeam && !preview ? (
            <CrmNewButton label="Nueva palabra" onClick={() => setEditing(emptyForm())} />
          ) : undefined
        }
      />

      {magnets.length === 0 ? (
        <CrmEmptyState
          icon={Sparkles}
          title="Todavía no hay palabras"
          description="Crea una por cada video: la palabra que dices en cámara, el material que entrega y el texto con el que respondes el comentario."
        />
      ) : (
        <CrmDataList>
          {magnets.map((row) => (
            <CrmDataListRow
              key={row.id}
              actions={
                canManageTeam && !preview ? (
                  <CrmRowActions>
                    <CrmRowAction
                      icon={Copy}
                      label="Copiar respuesta del comentario"
                      onClick={() => void copy(replyFor(row), "Respuesta")}
                    />
                    <CrmRowAction
                      icon={MessageCircle}
                      label="Copiar mensaje directo"
                      onClick={() => void copy(dmFor(row), "Mensaje")}
                    />
                    <CrmRowAction
                      icon={Sparkles}
                      label="Editar"
                      onClick={() =>
                        setEditing({
                          id: row.id,
                          keyword: row.keyword,
                          label: row.label,
                          title: row.title,
                          description: row.description ?? "",
                          deliveryUrl: row.deliveryUrl,
                          replyText: row.replyText ?? "",
                          dmText: row.dmText ?? "",
                          isActive: row.isActive,
                        })
                      }
                    />
                    <CrmRowDelete label="Borrar" onClick={() => remove(row)} />
                  </CrmRowActions>
                ) : undefined
              }
            >
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-medium">{row.label}</p>
                <p className="truncate text-xs text-muted-foreground">{row.title}</p>
                <button
                  type="button"
                  onClick={() => void copy(publicUrl(row.keyword), "Enlace")}
                  className="mt-1 max-w-full truncate text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {publicUrl(row.keyword)}
                </button>
              </div>

              <div className="sm:w-40">
                <p className="text-xs text-muted-foreground">
                  Lo pidieron{" "}
                  <span className="font-medium text-foreground">{row.claimCount}</span>
                  {row.claimCount7d > 0 ? ` · ${row.claimCount7d} esta semana` : ""}
                </p>
              </div>

              <div className="sm:w-28">
                {row.isActive ? (
                  <Badge className="border-success/40 bg-success/10 text-success">
                    Activa
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Apagada
                  </Badge>
                )}
              </div>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}

      <CrmModal
        title={editing?.id ? "Editar palabra" : "Nueva palabra"}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <CrmField
                label="Palabra del video *"
                description="La que dices en cámara: ÉXITO, SANACIÓN…"
              >
                <Input
                  value={editing.label}
                  onChange={(e) =>
                    setEditing((f) =>
                      f
                        ? {
                            ...f,
                            label: e.target.value,
                            // La palabra de la URL sigue a la del video
                            // mientras nadie la toque a mano.
                            keyword: f.id ? f.keyword : e.target.value,
                          }
                        : f
                    )
                  }
                  placeholder="ÉXITO"
                />
              </CrmField>

              <CrmField
                label="En la dirección"
                description="Así queda el enlace que pegas en el comentario."
              >
                <Input
                  value={editing.keyword}
                  onChange={(e) =>
                    setEditing((f) => (f ? { ...f, keyword: e.target.value } : f))
                  }
                  placeholder="exito"
                />
              </CrmField>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="magnet-title">Título del material *</Label>
              <Input
                id="magnet-title"
                value={editing.title}
                onChange={(e) =>
                  setEditing((f) => (f ? { ...f, title: e.target.value } : f))
                }
                placeholder="Guía: 7 pasos para atraer el éxito"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="magnet-desc">De qué va (opcional)</Label>
              <Textarea
                id="magnet-desc"
                rows={2}
                value={editing.description}
                onChange={(e) =>
                  setEditing((f) => (f ? { ...f, description: e.target.value } : f))
                }
                placeholder="Una o dos líneas que se leen antes de dejar el correo."
              />
            </div>

            <CrmField
              label="El material *"
              description="Pega un enlace (https://…) o sube el archivo: PDF, imagen o audio."
            >
              <div className="space-y-2">
                <Input
                  value={editing.deliveryUrl}
                  onChange={(e) =>
                    setEditing((f) => (f ? { ...f, deliveryUrl: e.target.value } : f))
                  }
                  placeholder="https://… o sube un archivo"
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,audio/mpeg,audio/mp4"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload aria-hidden />
                  {uploading ? "Subiendo…" : "Subir archivo"}
                </Button>
              </div>
            </CrmField>

            <CrmField
              label="Respuesta al comentario"
              description="Se copia de un toque desde la lista. El enlace se añade solo al final."
            >
              <Textarea
                rows={2}
                value={editing.replyText}
                onChange={(e) =>
                  setEditing((f) => (f ? { ...f, replyText: e.target.value } : f))
                }
                placeholder="¡Listo! Aquí está tu material 👇"
              />
            </CrmField>

            <CrmField
              label="Mensaje directo (opcional)"
              description="Para cuando respondes por privado. Si lo dejas vacío se usa el del comentario."
            >
              <Textarea
                rows={2}
                value={editing.dmText}
                onChange={(e) =>
                  setEditing((f) => (f ? { ...f, dmText: e.target.value } : f))
                }
                placeholder="Hola, aquí tienes lo que te prometí 👇"
              />
            </CrmField>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(e) =>
                  setEditing((f) => (f ? { ...f, isActive: e.target.checked } : f))
                }
              />
              Activa (apagada, su página responde 404)
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <CrmFormActions size="sm">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void save()}
                disabled={
                  saving ||
                  !editing.keyword.trim() ||
                  !editing.title.trim() ||
                  !editing.deliveryUrl.trim()
                }
              >
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </CrmFormActions>
          </div>
        )}
      </CrmModal>
    </CrmPageShell>
  );
};

export default MagnetsPageClient;
