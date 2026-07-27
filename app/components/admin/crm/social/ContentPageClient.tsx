"use client";

import { useCallback, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmPageShell from "../CrmPageShell";

type Account = {
  id: string;
  provider: string;
  displayName: string | null;
  username: string | null;
  isActive: boolean;
  lastError: string | null;
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
  /** Mensaje de vuelta del OAuth (?tiktok=connected|denied|error…). */
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

const CONNECT_MESSAGE: Record<string, string> = {
  connected: "Cuenta de TikTok conectada.",
  denied: "Cancelaste la autorización en TikTok.",
  bad_state: "El enlace de conexión caducó. Vuelve a intentarlo.",
  invalid: "TikTok no devolvió un código válido.",
  error: "No se pudo completar la conexión con TikTok.",
};

const ContentPageClient = ({
  canWrite,
  audited,
  connectResult,
  initialAccounts,
  initialPosts,
}: Props) => {
  // Los datos iniciales llegan renderizados del servidor, así que no hace falta
  // un efecto de carga al montar (que además dispararía un render en cascada).
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    connectResult ? (CONNECT_MESSAGE[connectResult] ?? null) : null
  );

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/social/posts", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { accounts: Account[]; posts: Post[] };
    setAccounts(data.accounts);
    setPosts(data.posts);
  }, []);

  const account = accounts[0] ?? null;

  // Navegación completa, no fetch: el endpoint redirige a TikTok y el usuario
  // tiene que acabar en su dominio para autorizar.
  const startConnect = () => {
    window.location.href = "/api/admin/social/tiktok/connect";
  };

  const submit = async () => {
    if (!account || !mediaUrl.trim() || busy) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/social/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        caption: caption.trim() || null,
        mediaUrls: [mediaUrl.trim()],
        // Sin auditoría el servidor lo forzará a SELF_ONLY de todos modos.
        privacyLevel: audited ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY",
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }),
    });

    if (res.ok) {
      setCaption("");
      setMediaUrl("");
      setScheduledAt("");
      setNotice("Publicación guardada.");
      await load();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "No se pudo guardar.");
    }
    setBusy(false);
  };

  const act = async (id: string, action: "cancel" | "publish_now") => {
    setError(null);
    const res = await fetch(`/api/admin/social/posts/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "La acción falló.");
    }
    await load();
  };

  return (
    <CrmPageShell>
      <header className="pb-4">
        <h1 className="text-xl font-semibold">Contenido</h1>
        <p className="text-sm text-muted-foreground">
          Programa y publica vídeos en TikTok desde el CRM.
        </p>
      </header>

      {notice && <p className="pb-3 text-sm text-emerald-600">{notice}</p>}
      {error && <p className="pb-3 text-sm text-destructive">{error}</p>}

      {!audited && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <strong>TikTok todavía no auditó la app.</strong> Todo lo que se
          publique saldrá en modo privado (solo tú), y la cuenta debe estar en
          privado al publicar. Cuando aprueben la auditoría, pon{" "}
          <code>TIKTOK_AUDITED=true</code> y se podrá publicar en público.
        </div>
      )}

      {/* Cuenta conectada */}
      <section className="mb-6 rounded-lg border p-4">
        <h2 className="mb-2 text-sm font-medium">Cuenta</h2>
        {!account && (
          <div className="flex items-center gap-3">
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
        {account && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline">{account.provider}</Badge>
            <span>{account.username ?? account.displayName ?? "—"}</span>
            {!account.isActive && (
              <>
                <Badge variant="destructive">Desconectada</Badge>
                <Button size="sm" variant="outline" onClick={startConnect}>
                  Reconectar
                </Button>
              </>
            )}
            {account.lastError && (
              <span className="text-xs text-destructive">{account.lastError}</span>
            )}
          </div>
        )}
      </section>

      {/* Composer */}
      {account && canWrite && (
        <section className="mb-6 space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Nueva publicación</h2>

          <div className="space-y-1">
            <Label htmlFor="sp-media">URL del vídeo (Blob)</Label>
            <Input
              id="sp-media"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://….vercel-storage.com/video.mp4"
            />
            <p className="text-xs text-muted-foreground">
              El publicador descarga el archivo y sube los bytes a TikTok, así
              que no hace falta verificar el dominio.
            </p>
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
            <Label htmlFor="sp-when">Programar para (vacío = borrador)</Label>
            <Input
              id="sp-when"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>

          <Button onClick={() => void submit()} disabled={busy || !mediaUrl.trim()}>
            {scheduledAt ? "Programar" : "Guardar borrador"}
          </Button>
        </section>
      )}

      {/* Lista */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Publicaciones</h2>
        {posts.length === 0 && (
          <p className="text-sm text-muted-foreground">Todavía no hay nada.</p>
        )}
        {posts.map((post) => (
          <div
            key={post.id}
            className="flex items-center gap-3 rounded-md border p-3 text-sm"
          >
            <Badge variant="outline">
              {STATUS_LABEL[post.status] ?? post.status}
            </Badge>
            <span className="min-w-0 flex-1 truncate">
              {post.caption || <em className="opacity-60">Sin descripción</em>}
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
                  variant="outline"
                  onClick={() => void act(post.id, "publish_now")}
                >
                  Publicar ya
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void act(post.id, "cancel")}
                >
                  Cancelar
                </Button>
              </span>
            )}
          </div>
        ))}
      </section>
    </CrmPageShell>
  );
};

export default ContentPageClient;
