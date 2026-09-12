"use client";

import Link from "next/link";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
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
  paidAt: string | null;
  enrollmentId: string | null;
  revokedAt: string | null;
  createdAt: string;
  product: { id: string; title: string };
  /** `null` en un enlace abierto, creado sin ficha. */
  contact: { id: string; firstName: string; lastName: string | null } | null;
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
  // Datos escritos a mano cuando la persona todavia no esta en el CRM.
  buyerName: "",
  buyerPhone: "",
  buyerEmail: "",
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
    // Lo unico obligatorio es el producto. Sin contacto y sin datos escritos
    // el enlace se crea igual: es un cobro abierto, y esa era justo la
    // limitacion que impedia cobrar.
    if (!form.productId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: form.contactId || undefined,
          buyer:
            !form.contactId &&
            (form.buyerPhone.trim() || form.buyerEmail.trim())
              ? {
                  firstName: form.buyerName.trim() || undefined,
                  phone: form.buyerPhone.trim() || undefined,
                  email: form.buyerEmail.trim() || undefined,
                }
              : undefined,
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
    // Cobrado primero: gana a revocado y a vencido. Un enlace que ya trajo el
    // dinero es eso, pase lo que pase con el enlace despues.
    if (row.paidAt) return { label: "Pagado", tone: "paid" as const };
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
        description="Para UNA persona: quien lo abre ve su nombre y el cobro queda en su ficha. Para mandar un paquete a varias personas está el enlace fijo, que se copia desde la propia tarjeta en Paquetes."
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

      {/*
        La diferencia entre los dos enlaces no es de matiz: es a quién se le
        atribuye el cobro. Decirla aquí, donde se decide crear uno, evita el
        error caro — mandar un enlace personal a un grupo y que los cobros de
        todos acaben colgados de la misma ficha.
      */}
      <Alert>
        <AlertDescription>
          <strong className="font-medium text-foreground">
            ¿Y si es para varias personas?
          </strong>{" "}
          Cada paquete tiene su enlace fijo, que no caduca y sirve para
          cualquiera: se copia con el icono de copiar en{" "}
          <Link href="/admin/products" className="underline underline-offset-2">
            Paquetes
          </Link>
          . Los de aquí son para una sola persona, y por eso el cobro se le
          atribuye a ella.
        </AlertDescription>
      </Alert>

      <CrmModal
        title="Nuevo enlace de pago"
        open={creating && canManageTeam}
        onClose={() => setCreating(false)}
      >
        <div className="space-y-4">
          {/* El producto primero: es lo unico obligatorio y lo que decide el
              precio. A quien se le manda puede no saberse todavia. */}
          <SearchableSelect
            id="payment-link-product"
            label="Producto"
            value={form.productId}
            onChange={(v) => setForm((f) => ({ ...f, productId: v }))}
            options={(products ?? []).map((p) => ({
              value: p.id,
              label: p.title,
            }))}
            placeholder="Elige el producto"
          />

          <div className="space-y-2">
            <ContactPickerField
              id="payment-link-contact"
              label="Para quien (opcional)"
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
              placeholder="Busca un contacto, o escribe los datos abajo"
            />

            {/* Sin contacto elegido, se puede escribir a mano. Se da de alta
                al crear el enlace, no al pagar, para que el cobro salga ya con
                dueno. Si tampoco se escribe nada, el enlace es abierto. */}
            {!form.contactId && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  aria-label="Nombre de quien paga"
                  value={form.buyerName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerName: e.target.value }))
                  }
                  placeholder="Nombre"
                  maxLength={120}
                />
                <Input
                  aria-label="Telefono de quien paga"
                  type="tel"
                  value={form.buyerPhone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerPhone: e.target.value }))
                  }
                  placeholder="Telefono"
                  maxLength={30}
                />
                <Input
                  aria-label="Correo de quien paga"
                  type="email"
                  value={form.buyerEmail}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerEmail: e.target.value }))
                  }
                  placeholder="Correo"
                  maxLength={200}
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
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
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment-link-expiry">Caduca (dias)</Label>
              <Input
                id="payment-link-expiry"
                type="number"
                min={1}
                max={90}
                value={form.expiresInDays}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expiresInDays: e.target.value }))
                }
                placeholder="Sin caducidad"
              />
            </div>
          </div>

          <CrmFormActions size="sm">
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !form.productId}
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
                  {/* Un enlace abierto no tiene a quien nombrar. Se dice lo
                      que es en vez de dejar el hueco: la lista tiene que
                      distinguir de un vistazo los dos tipos. */}
                  <p className="truncate font-medium">
                    {row.contact
                      ? `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim()
                      : "Enlace abierto"}
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
                  {status.tone === "paid" ? (
                    row.enrollmentId ? (
                      <Link
                        href={`/admin/enrollments/${row.enrollmentId}`}
                        className="inline-flex"
                      >
                        <Badge className="border-success/40 bg-success/10 text-success">
                          {status.label} →
                        </Badge>
                      </Link>
                    ) : (
                      <Badge className="border-success/40 bg-success/10 text-success">
                        {status.label}
                      </Badge>
                    )
                  ) : status.tone === "active" ? (
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
