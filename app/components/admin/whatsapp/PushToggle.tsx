"use client";

import { BellRing, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
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
const PushToggle = () => {
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
    <section className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm">
      <h2 className="flex items-center gap-1.5 font-semibold">
        <BellRing className="size-4" /> Avisos en este dispositivo
      </h2>
      <p className="text-xs text-muted-foreground">
        Te avisa al instante cuando la IA te pasa un chat (un pago, algo que no sabe, algo urgente) y
        cuando agenda una cita. También llegan por correo.
      </p>
      {state === "loading" && <Loader2 className="size-4 animate-spin" />}
      {state === "unsupported" && (
        <p className="text-xs text-amber-700">
          Este navegador no admite avisos. En iPhone: abre el CRM en Safari → Compartir → «Añadir a
          pantalla de inicio», y activa los avisos desde ahí.
        </p>
      )}
      {state === "no_keys" && (
        <p className="text-xs text-amber-700">
          Faltan las claves de push (WEB_PUSH_PUBLIC_KEY y WEB_PUSH_PRIVATE_KEY) en Vercel.
        </p>
      )}
      {state === "off" && (
        <Button size="sm" onClick={enable} disabled={busy} className="bg-[#128c4a] hover:bg-[#0f7a40]">
          {busy ? <Loader2 className="animate-spin" /> : <BellRing />} Activar avisos aquí
        </Button>
      )}
      {state === "on" && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-emerald-700">Activados en este dispositivo</span>
          <Button size="xs" variant="ghost" onClick={disable} disabled={busy}>
            Desactivar
          </Button>
        </div>
      )}
    </section>
  );
};

export default PushToggle;
