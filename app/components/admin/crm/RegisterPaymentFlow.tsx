"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { formatMoneyMinor } from "@/lib/crm/money";
import { productSelectOptions } from "@/lib/crm/form-select-options";
import { cn } from "@/lib/utils";
import ContactFormModal from "./ContactFormModal";
import ContactPickerField from "./ContactPickerField";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";
import RegisterPaymentForm, { type RegisteredPayment } from "./RegisterPaymentForm";
import SearchableSelect from "./SearchableSelect";
import { useActiveProducts } from "./hooks/useReferenceData";

type FlowContact = { id: string; name: string };

type FlowEnrollment = {
  id: string;
  productId?: string;
  productTitle: string;
  status?: string;
  amountMinor?: number | null;
  currency?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Contacto ya elegido (ficha del contacto): se salta el primer paso. */
  contact?: FlowContact;
  /** Servicio ya elegido (Membresías): se salta hasta el pago. */
  enrollment?: FlowEnrollment;
  onSuccess?: (payment: RegisteredPayment) => void;
};

type ApiEnrollment = {
  id: string;
  status: string;
  productId: string;
  amountMinor: number | null;
  currency: string | null;
  product: { title: string };
};

const OTHER_PRODUCT = "__otro__";

/** Primero lo que espera un pago; después lo activo; al final el resto. */
const STATUS_ORDER: Record<string, number> = {
  PENDING_PAYMENT: 0,
  LEAD: 1,
  ACTIVE: 2,
};

const REUSABLE_STATUSES = new Set(["PENDING_PAYMENT", "LEAD"]);

/**
 * «Registrar pago», el mismo desde cualquier sitio.
 *
 * Había cuatro botones repartidos por la ficha del contacto, el detalle del
 * servicio y Membresías, y ninguno en Pagos: para apuntar una transferencia
 * había que saber de antemano en qué servicio caía. Aquí se va en tres pasos
 * —contacto, servicio, pago— y se salta cualquiera que ya venga dado.
 *
 * Si el servicio no existe, se crea en `PENDING_PAYMENT` al pedir el código de
 * verificación, no al elegirlo: cerrar el diálogo antes no deja servicios a
 * medias. Y si ya hay uno pendiente de ese mismo paquete, se reutiliza.
 */
const RegisterPaymentFlow = ({ open, onClose, contact, enrollment, onSuccess }: Props) => (
  <CrmModal open={open} title="Registrar pago" onClose={onClose}>
    {open ? (
      <FlowBody
        contact={contact}
        enrollment={enrollment}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    ) : null}
  </CrmModal>
);

const FlowBody = ({
  contact: givenContact,
  enrollment: givenEnrollment,
  onClose,
  onSuccess,
}: Omit<Props, "open">) => {
  const { toast } = useCrm();
  const [contact, setContact] = useState<FlowContact | null>(givenContact ?? null);
  const [contactQuery, setContactQuery] = useState("");
  const [creatingContact, setCreatingContact] = useState(false);
  const [enrollments, setEnrollments] = useState<ApiEnrollment[] | null>(null);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [choice, setChoice] = useState<string>("");
  const [productId, setProductId] = useState("");
  const [step, setStep] = useState<"contact" | "service" | "payment">(
    givenEnrollment ? "payment" : givenContact ? "service" : "contact",
  );
  const { products } = useActiveProducts(!givenEnrollment);

  const loadEnrollments = async (contactId: string) => {
    setLoadingEnrollments(true);
    try {
      const res = await fetch(`/api/admin/contacts/${contactId}`);
      if (!res.ok) throw new Error("load_failed");
      const data = (await res.json()) as { contact?: { enrollments?: ApiEnrollment[] } };
      const list = [...(data.contact?.enrollments ?? [])].sort(
        (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
      );
      setEnrollments(list);
      setChoice(list[0]?.id ?? OTHER_PRODUCT);
    } catch {
      toast("No se pudieron cargar los servicios del contacto", "error");
      setEnrollments([]);
      setChoice(OTHER_PRODUCT);
    } finally {
      setLoadingEnrollments(false);
    }
  };

  // Con el contacto ya dado, los servicios se piden al montar el paso.
  const [requested, setRequested] = useState(false);
  if (step === "service" && contact && !requested) {
    setRequested(true);
    void loadEnrollments(contact.id);
  }

  const pickContact = (next: FlowContact) => {
    setContact(next);
    setRequested(false);
    setEnrollments(null);
    setStep("service");
  };

  if (step === "contact") {
    return (
      <div className="space-y-4 text-sm">
        <ContactPickerField
          id="reg-flow-contact"
          label="¿De quién es el pago?"
          value={contact?.id ?? ""}
          onSelect={(c) =>
            c ? pickContact({ id: c.id, name: `${c.firstName} ${c.lastName ?? ""}`.trim() }) : setContact(null)
          }
          onQueryChange={setContactQuery}
        />
        <p className="text-xs text-muted-foreground">
          {contactQuery.trim().length >= 2 ? "¿No aparece? " : "¿Es alguien nuevo? "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setCreatingContact(true)}
          >
            Crear contacto
          </button>
        </p>
        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
        <ContactFormModal
          open={creatingContact}
          onClose={() => setCreatingContact(false)}
          onSaved={(result) => {
            setCreatingContact(false);
            if (result?.contactId) {
              pickContact({ id: result.contactId, name: "Contacto nuevo" });
            }
          }}
        />
      </div>
    );
  }

  if (step === "service") {
    const otherSelected = choice === OTHER_PRODUCT;
    return (
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-border bg-secondary/25 px-4 py-2.5">
          <p className="text-xs text-muted-foreground">Contacto</p>
          <p className="font-medium">{contact?.name}</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">¿Qué está pagando?</legend>
          {loadingEnrollments || enrollments === null ? (
            <p className="text-xs text-muted-foreground">Cargando servicios…</p>
          ) : (
            <>
              {enrollments.map((en) => (
                <label
                  key={en.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    choice === en.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name="reg-flow-service"
                    value={en.id}
                    checked={choice === en.id}
                    onChange={() => setChoice(en.id)}
                    className="accent-[var(--primary)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{en.product.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {enrollmentStatusLabel(en.status)}
                      {en.amountMinor != null && en.currency
                        ? ` · ${formatMoneyMinor(en.amountMinor, en.currency)} ${en.currency}`
                        : ""}
                    </span>
                  </span>
                </label>
              ))}
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  otherSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="reg-flow-service"
                  value={OTHER_PRODUCT}
                  checked={otherSelected}
                  onChange={() => setChoice(OTHER_PRODUCT)}
                  className="accent-[var(--primary)]"
                />
                <span className="font-medium">
                  {enrollments.length === 0 ? "Elegir paquete" : "Otro paquete…"}
                </span>
              </label>
              {otherSelected ? (
                <div className="pl-1">
                  <Label className="sr-only" htmlFor="reg-flow-product">Paquete</Label>
                  <SearchableSelect
                    id="reg-flow-product"
                    label="Paquete"
                    value={productId}
                    options={productSelectOptions(products)}
                    onChange={setProductId}
                    searchPlaceholder="Buscar paquete…"
                  />
                </div>
              ) : null}
            </>
          )}
        </fieldset>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => (givenContact ? onClose() : setStep("contact"))}
          >
            {givenContact ? "Cancelar" : "Atrás"}
          </Button>
          <Button
            onClick={() => setStep("payment")}
            disabled={enrollments === null || (otherSelected && !productId)}
          >
            Continuar
          </Button>
        </div>
      </div>
    );
  }

  // Paso de pago.
  const existing = givenEnrollment
    ? null
    : choice !== OTHER_PRODUCT
      ? (enrollments ?? []).find((en) => en.id === choice) ?? null
      : null;
  // Un servicio pendiente del mismo paquete se reutiliza en vez de duplicarlo.
  const reusable =
    !givenEnrollment && choice === OTHER_PRODUCT
      ? (enrollments ?? []).find(
          (en) => en.productId === productId && REUSABLE_STATUSES.has(en.status),
        ) ?? null
      : null;
  const target = givenEnrollment ?? existing ?? reusable;
  const product = products.find((p) => p.id === productId);
  const productTitle =
    givenEnrollment?.productTitle ??
    existing?.product.title ??
    reusable?.product.title ??
    product?.title ??
    "Servicio";

  const ensureEnrollment = async (): Promise<string | null> => {
    if (!contact || !productId) return null;
    const res = await fetch("/api/admin/enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId: contact.id, productId, status: "PENDING_PAYMENT" }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      enrollment?: { id: string };
    };
    if (!res.ok || !data.enrollment) {
      toast(
        data.error === "DUPLICATE_SERVICE"
          ? "Este contacto ya tiene ese servicio pendiente."
          : data.error === "ACTIVE_THERAPY_EXISTS"
            ? "Este contacto ya tiene otra terapia activa."
            : data.error === "THERAPY_MISSING_SESSIONS"
              ? "Ese producto de terapia no tiene sesiones configuradas."
              : "No se pudo crear el servicio.",
        "error",
      );
      return null;
    }
    return data.enrollment.id;
  };

  return (
    <RegisterPaymentForm
      enrollmentId={target?.id ?? null}
      ensureEnrollment={target ? undefined : ensureEnrollment}
      productTitle={productTitle}
      contactName={contact?.name ?? ""}
      suggestedAmountMinor={target?.amountMinor ?? null}
      currency={target?.currency ?? "COP"}
      allowCurrencyChoice={!target?.currency}
      cancelLabel={givenEnrollment ? "Cancelar" : "Atrás"}
      onCancel={() => (givenEnrollment ? onClose() : setStep("service"))}
      onSuccess={(payment) => {
        onSuccess?.(payment);
        onClose();
      }}
    />
  );
};

export default RegisterPaymentFlow;
