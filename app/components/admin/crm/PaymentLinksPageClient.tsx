"use client";

import { Link2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import ContactPickerField from "./ContactPickerField";
import CrmModal from "./CrmModal";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";
import { useActiveProducts } from "./hooks/useReferenceData";
import { groupProductsByKind } from "@/lib/crm/product-kind-labels";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmFormActions,
  CrmLoadingState,
  CrmRowActions,
  CrmRowDelete,
} from "./ui";

export type PaymentLinkListRow = {
  id: string;
  token: string;
  note: string | null;
  expiresAt: string | null;
  openedAt: string | null;
  checkoutStartedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  product: { id: string; title: string };
  contact: { id: string; firstName: string; lastName: string | null };
};

type Props = {
  preview: boolean;
  initialLinks?: PaymentLinkListRow[];
  siteUrl: string;
};

const emptyForm = () => ({
  contactId: "",
  contactLabel: "",
  productId: "",
  note: "",
  expiresInDays: "30",
});

/**
 * Genera el enlace que Dayana manda por WhatsApp tras acordar un paquete.
 *
 * Todo el valor está en lo que la página del enlace **no** tiene: catálogo,
 * comparativa, otras opciones. Aquí sólo se elige a quién, qué, y una nota de
 * una línea que recuerde de qué se habló.
 */
const PaymentLinksPageClient = ({ preview, initialLinks, siteUrl }: Props) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [links, setLinks] = useState<PaymentLinkListRow[]>(initialLinks ?? []);
  const [loading, setLoading] = useState(initialLinks === undefined);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (preview) {
      setLinks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/admin/payment-links")
      .then((r) => r.json())
      .then((d) => setLinks(d.links ?? []))
      .catch(() => toast("Error al cargar los enlaces", "error"))
      .finally(() => setLoading(false));
  }, [preview, toast]);

  useEffect(() => {
    if (initialLinks !== undefined) return;
    load();
  }, [initialLinks, load]);

  const { products } = useActiveProducts(creating);

  const urlFor = (token: string) => `${siteUrl}/pagar/${token}`;

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      toast("Enlace copiado", "success");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  const save = async () => {
    if (!form.contactId || !form.productId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: form.contactId,
          productId: form.productId,
          note: form.note.trim() || undefined,
          expiresInDays: form.expiresInDays
            ? Number(form.expiresInDays)
            : null,
        }),
      });
      const data = (await res.json()) as {
        link?: PaymentLinkListRow;
        error?: string;
      };
      if (!res.ok || !data.link) {
        toast("No se pudo crear el enlace", "error");
        return;
      }
      setLinks((prev) => [data.link!, ...prev]);
      setCreating(false);
      setForm(emptyForm());
      await copy(data.link.token);
    } finally {
      setSaving(false);
    }
  };

  const revoke = (row: PaymentLinkListRow) => {
    confirm({
      title: "Revocar el enlace",
      message: `El enlace de ${row.product.title} dejará de funcionar. Quien lo tenga abierto verá una página de error.`,
      confirmLabel: "Revocar",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/payment-links?id=${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          toast("No se pudo revocar", "error");
          return;
        }
        setLinks((prev) =>
          prev.map((l) =>
            l.id === row.id
              ? { ...l, revokedAt: new Date().toISOString() }
              : l,
          ),
        );
        toast("Enlace revocado", "success");
      },
    });
  };

  const statusOf = (row: PaymentLinkListRow) => {
    if (row.revokedAt) return { label: "Revocado", tone: "muted" as const };
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return { label: "Vencido", tone: "muted" as const };
    }
    if (row.checkoutStartedAt) {
      return { label: "Empezó a pagar", tone: "active" as const };
    }
    if (row.openedAt) return { label: "Lo abrió", tone: "active" as const };
    return { label: "Sin abrir", tone: "muted" as const };
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Enlaces de pago"
        description="Tras acordar un paquete por llamada o WhatsApp, genera un enlace con ese producto y nada más. Quien lo abre ve su nombre, el precio y un botón."
        action={
          canManageTeam && !preview ? (
            <CrmNewButton
              label="Nuevo enlace"
              onClick={() => {
                setForm(emptyForm());
                setCreating(true);
              }}
            />
          ) : undefined
        }
      />

      <CrmModal
        title="Nuevo enlace de pago"
        open={creating && canManageTeam}
        onClose={() => setCreating(false)}
      >
        <div className="space-y-4">
          <ContactPickerField
            id="payment-link-contact"
            label="¿Para quién?"
            value={form.contactLabel}
            onSelect={(c) =>
              setForm((f) => ({
                ...f,
                contactId: c?.id ?? "",
                contactLabel: c
                  ? `${c.firstName} ${c.lastName ?? ""}`.trim()
                  : "",
              }))
            }
            required
          />

          <SearchableSelect
            id="payment-link-product"
            label="¿Qué acordaron?"
            value={form.productId}
            onChange={(v) => setForm((f) => ({ ...f, productId: v }))}
            options={groupProductsByKind(products ?? []).flatMap((g) =>
              g.items.map((p) => ({
                value: p.id,
                label: p.title,
                group: g.label,
              })),
            )}
            placeholder="Elige el producto"
          />

          <div className="space-y-1.5">
            <Label htmlFor="payment-link-note">Nota (opcional)</Label>
            <Input
              id="payment-link-note"
              value={form.note}
              onChange={(e) =>
                setForm((f) => ({ ...f, note: e.target.value }))
              }
              placeholder="Lo que hablamos el martes."
              maxLength={400}
            />
            <p className="text-xs text-muted-foreground">
              Se muestra bajo su nombre. Es lo que hace que el enlace no parezca
              automático.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-link-expiry">Caduca en (días)</Label>
            <Input
              id="payment-link-expiry"
              type="number"
              min={1}
              max={90}
              value={form.expiresInDays}
              onChange={(e) =>
                setForm((f) => ({ ...f, expiresInDays: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Vacío = no caduca. Con fecha evitas que un precio antiguo siga
              cobrándose meses después.
            </p>
          </div>

          <CrmFormActions size="sm">
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !form.contactId || !form.productId}
            >
              {saving ? "Creando…" : "Crear y copiar"}
            </Button>
          </CrmFormActions>
        </div>
      </CrmModal>

      {loading ? (
        <CrmLoadingState />
      ) : links.length === 0 ? (
        <CrmEmptyState
          icon={Link2}
          title="Todavía no has generado ningún enlace"
          description="Cuando cierres un paquete por llamada, genera aquí el enlace y mándaselo. Verá sólo eso, listo para pagar."
        />
      ) : (
        <CrmDataList>
          {links.map((row) => {
            const status = statusOf(row);
            const dead =
              Boolean(row.revokedAt) ||
              (row.expiresAt ? new Date(row.expiresAt) < new Date() : false);
            return (
              <CrmDataListRow
                key={row.id}
                actions={
                  <CrmRowActions>
                    <button
                      type="button"
                      onClick={() => void copy(row.token)}
                      disabled={dead}
                      className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-40"
                    >
                      Copiar
                    </button>
                    {canManageTeam && !dead && (
                      <CrmRowDelete
                        label="Revocar"
                        onClick={() => revoke(row)}
                      />
                    )}
                  </CrmRowActions>
                }
              >
                <div className="min-w-0 flex-1 basis-52">
                  <p className="truncate font-medium">
                    {`${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim()}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.product.title}
                  </p>
                </div>

                <div className="min-w-0 sm:w-56">
                  <p className="truncate text-xs text-muted-foreground">
                    {row.note ?? "—"}
                  </p>
                </div>

                <div className="sm:w-36">
                  {status.tone === "active" ? (
                    <Badge variant="secondary">{status.label}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {status.label}
                    </span>
                  )}
                </div>
              </CrmDataListRow>
            );
          })}
        </CrmDataList>
      )}
    </CrmPageShell>
  );
};

export default PaymentLinksPageClient;
