"use client";

import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmPageShell from "../CrmPageShell";
import { useCrm } from "../CrmProvider";

type Account = {
  id: string;
  provider: string;
  displayName: string | null;
  username: string | null;
  isActive: boolean;
  lastError: string | null;
  expiresInDays: number | null;
};

type Post = {
  id: string;
  status: string;
  caption: string | null;
  privacyLevel: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  postUrl: string | null;
  failedReason: string | null;
  account: { username: string | null; provider: string };
};

type Props = {
  canWrite: boolean;
  audited: boolean;
  connectResult: string | null;
  initialAccounts: Account[];
  initialPosts: Post[];
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  SCHEDULED: "Programada",
  PUBLISHING: "Publicando…",
  PUBLISHED: "Publicada",
  FAILED: "Falló",
  CANCELED: "Cancelada",
};

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Pública",
  MUTUAL_FOLLOW_FRIENDS: "Amigos mutuos",
  FOLLOWER_OF_CREATOR: "Seguidores",
  SELF_ONLY: "Solo yo (privada)",
};

const CONNECT_MESSAGE: Record<string, string> = {
  connected: "Cuenta de TikTok conectada.",
  denied: "Cancelaste la autorización en TikTok.",
  bad_state: "El enlace de conexión caducó. Vuelve a intentarlo.",
  invalid: "TikTok no devolvió un código válido.",
  error: "No se pudo completar la conexión con TikTok.",
};

const POST_ERROR: Record<string, string> = {
  missing_media: "Sube un archivo antes de guardar.",
  missing_account: "No hay ninguna cuenta conectada.",
  date_in_past: "Esa fecha ya pasó. Elige una futura.",
  invalid_date: "La fecha no es válida.",
  unsupported_type: "Ese tipo de archivo no se admite.",
  file_too_large: "El archivo es demasiado grande.",
  blob_not_configured: "El almacenamiento de archivos no está configurado.",
  inngest_unavailable: "La cola de tareas no está disponible.",
};

const humanize = (code?: string) =>
  (code && POST_ERROR[code]) || "No se pudo completar la acción.";

const ContentPageClient = ({
  canWrite,
  audited,
  connectResult,
  initialAccounts,
  initialPosts,
}: Props) => {
  const { toast, confirm } = useCrm();

  const [accounts, setAccounts] = useState(initialAccounts);
  const [posts, setPosts] = useState(initialPosts);
  const [accountId, setAccountId] = useState(initialAccounts[0]?.id ?? "");
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [privacy, setPrivacy] = useState(
    audited ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY"
  );
  const [disableComment, setDisableComment] = useState(false);
  const [disableDuet, setDisableDuet] = useState(false);
  const [disableStitch, setDisableStitch] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [editScheduledAt, setEditScheduledAt] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  const [notice] = useState<string | null>(
    connectResult ? (CONNECT_MESSAGE[connectResult] ?? null) : null
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/social/posts", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { accounts: Account[]; posts: Post[] };
      setAccounts(data.accounts);
      setPosts(data.posts);
    } catch {
      toast("No se pudo actualizar la lista.", "error");
    }
  }, [toast]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/social/upload", { method: "POST", body });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(humanize(data.error), "error");
        return;
      }
      const data = (await res.json()) as { url: string };
      setMediaUrl(data.url);
      setFileName(file.name);
      toast("Archivo subido.");
    } catch {
      toast("No se pudo subir el archivo. Revisa tu conexión.", "error");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!accountId || !mediaUrl || busy) return;
    setBusy("create");
    try {
      const res = await fetch("/api/admin/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          caption: caption.trim() || null,
          mediaUrls: [mediaUrl],
          privacyLevel: privacy,
          // `datetime-local` no lleva zona: se envía como ISO del navegador, que
          // es la zona en la que el operador acaba de escribirla.
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          disableComment,
          disableDuet,
          disableStitch,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(humanize(data.error), "error");
        return;
      }

      setCaption("");
      setMediaUrl("");
      setFileName("");
      setScheduledAt("");
      if (fileRef.current) fileRef.current.value = "";
      toast(scheduledAt ? "Publicación programada." : "Borrador guardado.");
      await load();
    } catch {
      toast("No se pudo guardar. Revisa tu conexión.", "error");
    } finally {
      setBusy(null);
    }
  };

  /** Guarda los cambios de una publicación que aún no salió. */
  const saveEdit = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/social/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: editCaption.trim() || null,
          scheduledAt: editScheduledAt
            ? new Date(editScheduledAt).toISOString()
            : null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(humanize(data.error), "error");
        return;
      }
      toast("Publicación actualizada.");
      setEditingId(null);
      await load();
    } catch {
      toast("No se pudo guardar. Revisa tu conexión.", "error");
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, action: "cancel" | "publish_now") => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/social/posts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(humanize(data.error), "error");
        return;
      }
      toast(action === "cancel" ? "Publicación cancelada." : "Enviada a la cola.");
      await load();
    } catch {
      toast("No se pudo completar la acción.", "error");
    } finally {
      setBusy(null);
    }
  };

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;

  const startConnect = () => {
    window.location.href = "/api/admin/social/tiktok/connect";
  };

  return (
    <CrmPageShell>
      <header className="pb-4">
        <h1 className="text-xl font-semibold">Contenido</h1>
        <p className="text-sm text-muted-foreground">
          Programa y publica vídeos en TikTok desde el CRM.
        </p>
      </header>

      {notice && (
        <p className="pb-3 text-sm text-emerald-600" role="status">
          {notice}
        </p>
      )}

      {!audited && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <strong>TikTok todavía no auditó la app.</strong> Todo saldrá en modo
          privado (solo tú), y la cuenta debe estar en privado al publicar.
          Cuando aprueben la auditoría, actívalo en{" "}
          <code>/admin/ajustes/integraciones</code> (o pon{" "}
          <code>TIKTOK_AUDITED=true</code>).
        </div>
      )}

      {/* Cuenta */}
      <section className="mb-6 rounded-lg border p-4">
        <h2 className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          Cuenta
        </h2>

        {accounts.length === 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              No hay ninguna cuenta de TikTok conectada.
            </p>
            {canWrite && (
              <Button size="sm" onClick={startConnect}>
                Conectar TikTok
              </Button>
            )}
          </div>
        )}

        {accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {accounts.length > 1 ? (
              <select
                aria-label="Cuenta"
                className="rounded-md border bg-background px-2 py-1 text-sm"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.username ?? a.displayName ?? a.id}
                  </option>
                ))}
              </select>
            ) : (
              <span>{account?.username ?? account?.displayName ?? "—"}</span>
            )}

            <Badge variant="outline">{account?.provider}</Badge>

            {account && !account.isActive && (
              <>
                <Badge variant="destructive">Desconectada</Badge>
                <Button size="sm" variant="outline" onClick={startConnect}>
                  Reconectar
                </Button>
              </>
            )}

            {account?.expiresInDays != null && account.expiresInDays <= 14 && (
              <span className="text-xs text-destructive">
                La autorización caduca en {account.expiresInDays} días
              </span>
            )}
          </div>
        )}
      </section>

      {/* Composer */}
      {account && canWrite && (
        <section className="mb-6 space-y-4 rounded-lg border p-4">
          <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Nueva publicación
          </h2>

          <div className="space-y-1">
            <Label htmlFor="sp-file">Vídeo</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                id="sp-file"
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" aria-hidden />
                {uploading ? "Subiendo…" : "Elegir archivo"}
              </Button>
              {fileName && (
                <span className="text-xs text-muted-foreground">{fileName}</span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sp-caption">Descripción</Label>
            <Textarea
              id="sp-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              maxLength={2200}
              placeholder="Texto del vídeo…"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sp-privacy">Visibilidad</Label>
            <select
              id="sp-privacy"
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value)}
              disabled={!audited}
            >
              {Object.entries(PRIVACY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {!audited && (
              <p className="text-xs text-muted-foreground">
                Bloqueado en privado hasta que TikTok apruebe la auditoría.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={disableComment}
                onCheckedChange={(v) => setDisableComment(v === true)}
              />
              Desactivar comentarios
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={disableDuet}
                onCheckedChange={(v) => setDisableDuet(v === true)}
              />
              Desactivar dúos
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={disableStitch}
                onCheckedChange={(v) => setDisableStitch(v === true)}
              />
              Desactivar stitch
            </label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sp-when">Programar para (vacío = borrador)</Label>
            <Input
              id="sp-when"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Se interpreta en la hora de tu equipo.
            </p>
          </div>

          <Button
            onClick={() => void submit()}
            disabled={busy === "create" || uploading || !mediaUrl}
          >
            {busy === "create"
              ? "Guardando…"
              : scheduledAt
                ? "Programar"
                : "Guardar borrador"}
          </Button>
        </section>
      )}

      {/* Lista */}
      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Publicaciones
        </h2>

        {posts.length === 0 && (
          <div className="rounded-md border p-4 text-sm">
            <p className="font-medium">Todavía no hay publicaciones</p>
            <p className="text-muted-foreground">
              Sube un vídeo arriba para programar la primera.
            </p>
          </div>
        )}

        {posts.map((post) => (
          <div
            key={post.id}
            className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm sm:gap-3"
          >
            <Badge variant="outline">
              {STATUS_LABEL[post.status] ?? post.status}
            </Badge>
            <span className="min-w-0 flex-1 truncate">
              {post.caption || <em className="opacity-60">Sin descripción</em>}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {PRIVACY_LABEL[post.privacyLevel] ?? post.privacyLevel}
            </span>
            {post.scheduledAt && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(post.scheduledAt).toLocaleString("es-CO")}
              </span>
            )}
            {post.failedReason && (
              <span className="shrink-0 text-xs text-destructive">
                {post.failedReason}
              </span>
            )}
            {post.postUrl && (
              <a
                href={post.postUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs underline"
              >
                Ver
              </a>
            )}

            {canWrite && ["DRAFT", "SCHEDULED", "FAILED"].includes(post.status) && (
              <span className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === post.id}
                  onClick={() => {
                    setEditingId(post.id);
                    setEditCaption(post.caption ?? "");
                    // `datetime-local` quiere `YYYY-MM-DDTHH:mm` en hora local.
                    setEditScheduledAt(
                      post.scheduledAt
                        ? new Date(
                            new Date(post.scheduledAt).getTime() -
                              new Date().getTimezoneOffset() * 60000
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ""
                    );
                  }}
                >
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === post.id}
                  onClick={() =>
                    confirm({
                      title: "Publicar ahora",
                      message: audited
                        ? "Se enviará a TikTok de inmediato y quedará visible según la visibilidad elegida."
                        : "Se enviará a TikTok de inmediato en modo privado.",
                      onConfirm: () => void act(post.id, "publish_now"),
                    })
                  }
                >
                  Publicar ya
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === post.id}
                  onClick={() =>
                    confirm({
                      title: "Cancelar publicación",
                      message: "No se enviará. Esto no se puede deshacer.",
                      onConfirm: () => void act(post.id, "cancel"),
                    })
                  }
                >
                  Cancelar
                </Button>
              </span>
            )}

            {editingId === post.id && (
              <div className="w-full space-y-2 border-t pt-3">
                <Label htmlFor={`edit-caption-${post.id}`}>Descripción</Label>
                <Textarea
                  id={`edit-caption-${post.id}`}
                  value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)}
                  rows={3}
                  maxLength={2200}
                />
                <Label htmlFor={`edit-when-${post.id}`}>
                  Programar para (vacío = borrador)
                </Label>
                <Input
                  id={`edit-when-${post.id}`}
                  type="datetime-local"
                  value={editScheduledAt}
                  onChange={(e) => setEditScheduledAt(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy === post.id}
                    onClick={() => void saveEdit(post.id)}
                  >
                    {busy === post.id ? "Guardando…" : "Guardar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    Descartar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
    </CrmPageShell>
  );
};

export default ContentPageClient;
