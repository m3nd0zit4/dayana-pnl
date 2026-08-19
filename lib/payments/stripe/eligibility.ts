import { ProductKind } from "@prisma/client";

/**
 * Managed Payments = Stripe/Link acts as merchant of record and handles sales
 * tax / VAT / GST, fraud, disputes and transaction support.
 *
 * It only covers **fully digital, fully automated** products. Stripe's own
 * wording: "If your service involves human intervention (such as live 1-1
 * coaching), it doesn't qualify". Physical goods, professional services and
 * live in-person events are excluded outright.
 *
 * Consequence for this catalogue:
 * - THERAPY  → 1:1 sessions over Meet with Dayana. Human-delivered, ineligible.
 * - WORKSHOP → live full-day workshop. Live event, ineligible.
 * - COURSE   → sold as an on-demand course library (pre-recorded video).
 *
 * Ineligible products still go through Stripe Checkout — just with
 * `managed_payments.enabled = false`, which means Dayana stays the merchant of
 * record for them, exactly as with PayPal and Mercado Pago today.
 *
 * The eligible tax-code list lives at
 * https://docs.stripe.com/payments/managed-payments/eligibility — Stripe
 * updates it, so re-check before adding a code here.
 */

/** Subset of Stripe's eligible tax codes that this catalogue can actually use. */
export const MANAGED_PAYMENTS_TAX_CODES = {
  /** On demand Online Courses - pre-recorded audio/video, streamed (no download). */
  onDemandCourseStreamed: "txcd_20060158",
  /** On demand Online Courses - pre-recorded, streamed AND downloadable. */
  onDemandCourseDownloadable: "txcd_20060258",
  /** On demand Online Courses - written material. */
  onDemandCourseWritten: "txcd_20060358",
  /** Training Services - Self-study Web-based, explicitly NOT instructor led. */
  selfStudyTraining: "txcd_20060058",
  /** Digital Audio Visual Works - streamed - subscription. */
  streamedAvSubscription: "txcd_10402200",
} as const;

/**
 * Tax codes for the ineligible products. Managed Payments is off for these, so
 * these are never checked against Stripe's eligible list — they exist so that
 * Stripe Tax can still classify the sale correctly if it is ever turned on.
 */
const SERVICE_TAX_CODES = {
  /** Professional services - general. */
  professionalServices: "txcd_20060000",
} as const;

export type StripeProductClassification = {
  taxCode: string;
  managedPayments: boolean;
  /** Why, in one line — surfaced by the setup script's summary table. */
  reason: string;
};

/**
 * `course-live` is classified as an on-demand online course and ships with
 * Managed Payments ON. Flagged at planning time and confirmed by the owner:
 * the membership also carries live Meet classes, so Stripe may later rule it
 * ineligible, hand back the indirect-tax liability and require turning this
 * off. The DB column `Product.stripeManagedPayments` is what checkout reads, so
 * flipping it off is a data change, not a deploy.
 */
export const classifyProductForStripe = (product: {
  id: string;
  kind: ProductKind;
}): StripeProductClassification => {
  switch (product.kind) {
    case ProductKind.COURSE:
      return {
        taxCode: MANAGED_PAYMENTS_TAX_CODES.onDemandCourseStreamed,
        managedPayments: true,
        reason: "curso on-demand (video pregrabado en streaming)",
      };
    case ProductKind.THERAPY:
      return {
        taxCode: SERVICE_TAX_CODES.professionalServices,
        managedPayments: false,
        reason: "sesiones 1:1 con intervención humana — no elegible",
      };
    case ProductKind.WORKSHOP:
      return {
        taxCode: SERVICE_TAX_CODES.professionalServices,
        managedPayments: false,
        reason: "taller en vivo — no elegible",
      };
  }
};
