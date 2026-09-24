"use client";

import { BellRing, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";
import { useCrm } from "../crm/CrmProvider";

const toKey = (base64: string) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/**
 * Activa los avisos push en este navegador o teléfono. En iPhone solo
 * funciona con el CRM instalado en la pantalla de inicio (Compartir →
 * Añadir a pantalla de inicio), por eso se explica aquí mismo.
 */
const PushToggle = ({ embedded = false }: { embedded?: boolean }) => {
  const { toast } = useCrm();
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "no_keys">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported");
        return;
      }
      const info = await fetch("/api/admin/whatsapp/push", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ publicKey: string | null }>) : null))
        .catch(() => null);
      if (!info?.publicKey) {
        setState("no_keys");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/admin/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast("El navegador no dio permiso para avisos.", "error");
        return;
      }
      const info = (await fetch("/api/admin/whatsapp/push").then((r) => r.json())) as {
        publicKey: string;
      };
      const reg = await navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin/" });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toKey(info.publicKey),
      });
      const res = await fetch("/api/admin/whatsapp/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sub.toJSON(), test: true }),
      });
      if (!res.ok) throw new Error();
      setState("on");
      toast("Avisos activados. Te llegó uno de prueba.", "success");
    } catch {
      toast("No se pudieron activar los avisos en este dispositivo.", "error");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/admin/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/admin/whatsapp/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
        });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={cn(
        "space-y-2 text-sm",
        embedded ? "px-3 py-3" : "rounded-xl border border-border bg-card p-3"
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-0.5">
          <h2 className="flex items-center gap-1.5 font-medium">
            <BellRing className="size-4 text-[#00a884]" aria-hidden /> Avisos en este dispositivo
          </h2>
          <p className="text-xs text-muted-foreground">
            Cuando la IA te pasa un chat o agenda una cita. También llegan por correo.
          </p>
        </div>
        <div className="shrink-0">
          {state === "loading" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {state === "off" && (
            <Button size="sm" onClick={enable} disabled={busy} className="bg-[#00a884] text-white hover:bg-[#008069]">
              {busy ? <Loader2 className="animate-spin" /> : <BellRing />} Activar aquí
            </Button>
          )}
          {state === "on" && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#008069] dark:text-[#00a884]">Activados aquí</span>
              <Button size="xs" variant="ghost" onClick={disable} disabled={busy}>
                Desactivar
              </Button>
            </div>
          )}
        </div>
      </div>
      {state === "unsupported" && (
        <p className="rounded-md bg-warning/10 px-2 py-1.5 text-xs">
          Este navegador no admite avisos. En iPhone: abre el CRM en Safari → Compartir → «Añadir a pantalla de
          inicio», y actívalos desde ahí.
        </p>
      )}
      {state === "no_keys" && (
        <p className="rounded-md bg-warning/10 px-2 py-1.5 text-xs">
          Faltan las claves de push (WEB_PUSH_PUBLIC_KEY y WEB_PUSH_PRIVATE_KEY) en Vercel.
        </p>
      )}
    </section>
  );
};

export default PushToggle;
