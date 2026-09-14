"use client";

import CrmModal from "./CrmModal";
import RegisterPaymentForm, { type RegisteredPayment } from "./RegisterPaymentForm";

export type { RegisteredPayment } from "./RegisterPaymentForm";

type Props = {
  open: boolean;
  onClose: () => void;
  enrollmentId: string;
  productTitle: string;
  contactName: string;
  suggestedAmountMinor?: number | null;
  currency?: string;
  onSuccess?: (payment: RegisteredPayment) => void;
};

/**
 * «Registrar pago» cuando el servicio ya está elegido (detalle del servicio).
 * El formulario vive en `RegisterPaymentForm`; desde Pagos, la ficha del
 * contacto o Membresías se usa `RegisterPaymentFlow`, que primero deja elegir
 * contacto y servicio.
 */
const RegisterPaymentModal = ({
  open,
  onClose,
  enrollmentId,
  productTitle,
  contactName,
  suggestedAmountMinor,
  currency = "USD",
  onSuccess,
}: Props) => (
  <CrmModal open={open} title="Registrar pago" onClose={onClose}>
    {open ? (
      <RegisterPaymentForm
        key={enrollmentId}
        enrollmentId={enrollmentId}
        productTitle={productTitle}
        contactName={contactName}
        suggestedAmountMinor={suggestedAmountMinor}
        currency={currency}
        onCancel={onClose}
        onSuccess={(payment) => {
          onSuccess?.(payment);
          onClose();
        }}
      />
    ) : null}
  </CrmModal>
);

export default RegisterPaymentModal;
