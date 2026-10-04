"use client";

import { retiredTemplateRemovable } from "@/lib/crm/event-reminder-template";
import { templateBodyProblem, toMetaBody, utilityCategoryWarning } from "@/lib/crm/whatsapp-template-rules";
import { CheckCircle2, Clock, Copy, Loader2, RefreshCw, Send, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import CrmPageShell from "../crm/CrmPageShell";
import { useCrm } from "../crm/CrmProvider";
import type { StarterTemplate, WaTemplate } from "@/lib/crm/whatsapp-templates";

type Prices = { currency: string; MARKETING: number; UTILITY: number };

const StatusPill = ({ status }: { status: string | null }) => {
  const s = (status ?? "").toUpperCase();
  if (s === "DELETED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f2f5] px-2 py-0.5 text-xs font-medium text-[#54656f]">
        <Trash2 className="size-3.5" /> Quitada de WhatsApp
      </span>
    );
  if (s === "APPROVED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#d9fdd3] px-2 py-0.5 text-xs font-medium text-[#006e4f]">
        <CheckCircle2 className="size-3.5" /> Aprobada
      </span>
    );
  if (s.startsWith("REJECTED") || s === "DISABLED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fef3f2] px-2 py-0.5 text-xs font-medium text-[#b42318]">
        <XCircle className="size-3.5" /> Rechazada{s.includes("·") ? ` (${s.split("·")[1].trim().toLowerCase().replace(/_/g, " ")})` : ""}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f2f5] px-2 py-0.5 text-xs font-medium text-[#54656f]">
      <Clock className="size-3.5" /> En revisión
    </span>
  );
};

/**
 * «Cómo crearla»: una recomendada con imagen arriba, que el CRM no puede crear
 * (solo crea plantillas de texto). Todo lo que hay que poner en el Hub, con
 * el cuerpo ya en {{1}}, {{2}}… en el orden que el CRM llena.
 */
const ManualTemplateGuide = ({ starter }: { starter: StarterTemplate }) => {
  const { toast } = useCrm();
  const { text, varNames } = toMetaBody(starter.body);
  const copy = (value: string, ok: string) =>
    void navigator.clipboard.writeText(value).then(
      () => toast(ok, "success"),
      () => toast("No se pudo copiar: selecciónalo y cópialo a mano.", "error")
    );
  return (
    <div className="space-y-2 rounded-lg bg-[#f5f6f6] p-3 text-sm dark:bg-muted/40">
      <div className="font-medium">Cómo crearla (en el Hub de 360dialog → Templates → New)</div>
      <ul className="space-y-0.5 text-xs text-[#54656f]">
        <li>
          Nombre: <code className="rounded bg-white px-1 dark:bg-card">{starter.key}</code>{" "}
          <button type="button" onClick={() => copy(starter.key, "Nombre copiado")} className="underline">
            copiar
          </button>
        </li>
        <li>Categoría: {starter.category === "MARKETING" ? "Marketing" : "Utilidad"} · Idioma: Español (es)</li>
        <li>Encabezado: Imagen (sube cualquier imagen de ejemplo)</li>
      </ul>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs font-medium">Cuerpo (pégalo tal cual)</span>
        <button
          type="button"
          onClick={() => copy(text, "Cuerpo copiado")}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#d1d7db] bg-white px-3 text-xs font-medium hover:bg-[#f5f6f6] dark:border-border dark:bg-card"
        >
          <Copy className="size-3.5" /> Copiar cuerpo
        </button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-lg bg-white p-2 text-xs whitespace-pre-wrap dark:bg-card">{text}</pre>
      <div className="text-xs font-medium">Ejemplo para cada variable</div>
      <ul className="space-y-0.5 text-xs text-[#54656f]">
        {varNames.map((v, i) => (
          <li key={v}>
            <code>{`{{${i + 1}}}`}</code> ({v}): {starter.example[v] ?? v}
          </li>
        ))}
      </ul>
      <p className="text-xs text-[#667781]">
        Cuando Meta la apruebe, toca «Actualizar estado»: queda ligada sola a la invitación con imagen y horarios.
      </p>
    </div>
  );
};

/**
 * Plantillas de WhatsApp: lo que Meta aprueba para poder escribirle a quien no
 * escribió en las últimas 24 h. Desde aquí se mandan a aprobar (las
 * recomendadas con un toque), se ve su estado y se pone el precio por mensaje.
 */
const WhatsAppTemplatesClient = ({ canEdit }: { canEdit: boolean }) => {
  const { toast } = useCrm();
  const [items, setItems] = useState<WaTemplate[] | null>(null);
  const [starters, setStarters] = useState<StarterTemplate[]>([]);
  const [prices, setPrices] = useState<Prices>({ currency: "USD", MARKETING: 0, UTILITY: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // «Quitar de WhatsApp»: la clave que espera la confirmación.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/templates", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as { items: WaTemplate[]; starters: StarterTemplate[]; prices: Prices };
    setItems(d.items);
    setStarters(d.starters);
    setPrices(d.prices);
  }, []);

  const post = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as { message?: string; items?: WaTemplate[] };
      if (!res.ok) throw new Error(d.message ?? "error");
      if (d.items) setItems(d.items);
      toast(ok, "success");
    } catch (e) {
      toast(`No se pudo: ${e instanceof Error ? e.message : ""}`, "error");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void (async () => {
      await load();
      // Al entrar se trae el estado real de 360dialog (aprobadas, en revisión…).
      if (canEdit) await post("sync", { action: "sync" }, "Plantillas al día");
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Una rechazada se puede corregir y volver a mandar.
  const existingKeys = new Set(
    (items ?? []).filter((t) => !t.metaApprovalStatus?.startsWith("REJECTED")).map((t) => t.key)
  );
  // Las retiradas no se vuelven a mandar; las de imagen se crean a mano.
  const pendingStarters = starters.filter((st) => !existingKeys.has(st.key) && !st.replacedBy);
  const submittable = pendingStarters.filter((st) => !st.manual);
  const titleOf = (key: string) => starters.find((s) => s.key === key)?.title ?? key;

  const submitAll = async () => {
    setBusy("all");
    const failed: string[] = [];
    for (const st of submittable) {
      const res = await fetch("/api/admin/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          key: st.key,
          title: st.title,
          category: st.category,
          body: drafts[st.key] ?? st.body,
          example: st.example,
        }),
      }).catch(() => null);
      const d = (await res?.json().catch(() => ({}))) as { message?: string; items?: WaTemplate[] } | undefined;
      if (!res?.ok) failed.push(`${st.title}: ${d?.message ?? "error"}`);
      else if (d?.items) setItems(d.items);
    }
    setBusy(null);
    if (failed.length) toast(`No se pudieron mandar: ${failed.join(" · ")}`, "error");
    else toast("Enviadas a revisión de Meta", "success");
  };

  return (
    <CrmPageShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold">Plantillas de WhatsApp</h1>
        {canEdit && (
          <button
            type="button"
            onClick={() => void post("sync", { action: "sync" }, "Plantillas al día")}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#d1d7db] bg-white px-4 text-sm font-medium hover:bg-[#f5f6f6] disabled:opacity-50 dark:border-border dark:bg-card"
          >
            {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Actualizar estado
          </button>
        )}
      </div>
      <p className="text-sm text-[#54656f]">
        WhatsApp deja escribir libremente solo a quien te escribió en las últimas 24 horas. Para escribirle a cualquier
        otra persona (el enlace de un evento, un recordatorio, un seguimiento) hace falta una plantilla aprobada por Meta,
        que se cobra por mensaje. Meta las revisa en minutos u horas.
      </p>

      <section className="space-y-2 rounded-xl border border-[#e9edef] bg-white p-4 dark:border-border dark:bg-card">
        <h2 className="font-semibold">Precio por mensaje con plantilla</h2>
        <p className="text-xs text-[#667781]">
          Míralo en el Hub de 360dialog (tarifas de Meta para Colombia). Se usa para mostrar el costo antes de cada envío.
        </p>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1">
            <span className="block text-xs text-[#667781]">Marketing (invitaciones)</span>
            <input
              type="number"
              step="0.0001"
              min={0}
              value={prices.MARKETING}
              disabled={!canEdit}
              onChange={(e) => setPrices({ ...prices, MARKETING: Number(e.target.value) })}
              className="h-9 w-32 rounded-lg border border-[#d1d7db] px-2 dark:border-border dark:bg-card"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-[#667781]">Utilidad (recordatorios, pagos)</span>
            <input
              type="number"
              step="0.0001"
              min={0}
              value={prices.UTILITY}
              disabled={!canEdit}
              onChange={(e) => setPrices({ ...prices, UTILITY: Number(e.target.value) })}
              className="h-9 w-32 rounded-lg border border-[#d1d7db] px-2 dark:border-border dark:bg-card"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-[#667781]">Moneda</span>
            <input
              value={prices.currency}
              maxLength={3}
              disabled={!canEdit}
              onChange={(e) => setPrices({ ...prices, currency: e.target.value.toUpperCase() })}
              className="h-9 w-20 rounded-lg border border-[#d1d7db] px-2 dark:border-border dark:bg-card"
            />
          </label>
          {canEdit && (
            <button
              type="button"
              onClick={() => void post("prices", { action: "prices", ...prices }, "Precios guardados")}
              disabled={busy !== null}
              className="h-9 rounded-full bg-[#00a884] px-4 font-medium text-white hover:bg-[#008069] disabled:opacity-50"
            >
              Guardar
            </button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Tus plantillas</h2>
        {items === null ? (
          <Loader2 className="size-5 animate-spin text-[#00a884]" />
        ) : items.length === 0 ? (
          <p className="text-sm text-[#667781]">Todavía no hay plantillas. Manda a aprobar las recomendadas de abajo.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((t) => (
              <li key={t.id} className="rounded-xl border border-[#e9edef] bg-white p-3 dark:border-border dark:bg-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  <StatusPill status={t.metaApprovalStatus} />
                  <span className="text-xs text-[#667781]">
                    {t.metaCategory === "MARKETING" ? "Marketing" : t.metaCategory === "UTILITY" ? "Utilidad" : t.metaCategory}
                  </span>
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-[#54656f]">{t.body}</p>
                {(() => {
                  // Retirada: queda de respaldo hasta que Meta apruebe la nueva.
                  const replacedBy = starters.find((s) => s.key === t.key)?.replacedBy;
                  if (!replacedBy) return null;
                  const deleted = (t.metaApprovalStatus ?? "").toUpperCase() === "DELETED";
                  // Las de recordatorio cuentan solo aprobadas como UTILITY: si Meta
                  // las pasa a Marketing, el CRM sigue usando esta.
                  const ready = retiredTemplateRemovable(t.key, items ?? []);
                  return (
                    <div className="mt-2 space-y-1.5 rounded-lg bg-[#f5f6f6] p-2 text-xs text-[#54656f] dark:bg-muted/40">
                      <div>
                        Reemplazada por {replacedBy.map((k) => `«${titleOf(k)}»`).join(" y ")}.{" "}
                        {deleted
                          ? ""
                          : ready
                            ? "La nueva ya está en uso: el CRM ya no usa esta."
                            : "Se sigue usando de respaldo hasta que Meta apruebe la nueva (como Utilidad si es un recordatorio)."}
                      </div>
                      {canEdit && !deleted && (
                        confirmDelete === t.key ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[#b42318]">
                              Se borra de WhatsApp (en todos los idiomas) y Meta no deja reutilizar el nombre por 30
                              días. ¿La quitas?
                            </span>
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() =>
                                void post(t.key, { action: "delete_retired", key: t.key }, "Plantilla quitada de WhatsApp").then(
                                  () => setConfirmDelete(null)
                                )
                              }
                              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#b42318] px-3 font-medium text-white disabled:opacity-50"
                            >
                              {busy === t.key ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Sí,
                              quitarla
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              className="h-9 rounded-full px-3 hover:bg-muted"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={!ready || busy !== null}
                            title={
                              ready
                                ? undefined
                                : "Se puede quitar cuando Meta apruebe la que la reemplaza (como Utilidad si es un recordatorio)."
                            }
                            onClick={() => setConfirmDelete(t.key)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#d1d7db] bg-white px-3 font-medium hover:bg-[#f5f6f6] disabled:opacity-50 dark:border-border dark:bg-card"
                          >
                            <Trash2 className="size-3.5" /> Quitar de WhatsApp
                          </button>
                        )
                      )}
                    </div>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex-1 font-semibold">Recomendadas para mandar a aprobar</h2>
            {submittable.length > 1 && (
              <button
                type="button"
                onClick={() => void submitAll()}
                disabled={busy !== null}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-50"
              >
                {busy === "all" && <Loader2 className="size-4 animate-spin" />} Mandar a aprobar todas ({submittable.length})
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {pendingStarters
              .map((st) => (
                <li key={st.key} className="space-y-2 rounded-xl border border-[#e9edef] bg-white p-3 dark:border-border dark:bg-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{st.title}</span>
                    <span className="text-xs text-[#667781]">{st.category === "MARKETING" ? "Marketing" : "Utilidad"}</span>
                    {st.manual && <span className="text-xs text-[#667781]">· con imagen arriba: se crea a mano</span>}
                  </div>
                  {st.manual ? (
                    <ManualTemplateGuide starter={st} />
                  ) : (
                    <>
                      <textarea
                        rows={Math.min(18, (drafts[st.key] ?? st.body).split("\n").length + 1)}
                        value={drafts[st.key] ?? st.body}
                        onChange={(e) => setDrafts({ ...drafts, [st.key]: e.target.value })}
                        className="w-full rounded-lg border border-[#d1d7db] p-2 text-sm dark:border-border dark:bg-card"
                      />
                      <p className="text-[11px] text-[#667781]">
                        {"{{nombre}}"}, {"{{evento}}"}, {"{{fecha}}"}, {"{{enlace}}"}… se rellenan solos al enviar.
                      </p>
                      {(() => {
                        // Lo que Meta rechaza o reclasifica, dicho antes de mandarla.
                        const body = drafts[st.key] ?? st.body;
                        const problem = templateBodyProblem(body);
                        const warn = utilityCategoryWarning(st.category, body);
                        return problem || warn ? (
                          <p className={`text-xs ${problem ? "text-[#b42318]" : "text-[#8a5a00]"}`}>{problem ?? warn}</p>
                        ) : null;
                      })()}
                      <button
                        type="button"
                        disabled={busy !== null || Boolean(templateBodyProblem(drafts[st.key] ?? st.body))}
                        onClick={() =>
                          void post(
                            st.key,
                            {
                              action: "create",
                              key: st.key,
                              title: st.title,
                              category: st.category,
                              body: drafts[st.key] ?? st.body,
                              example: st.example,
                            },
                            "Enviada a Meta para aprobación"
                          )
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-50"
                      >
                        {busy === st.key ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Mandar a aprobar
                      </button>
                    </>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}
    </CrmPageShell>
  );
};

export default WhatsAppTemplatesClient;
