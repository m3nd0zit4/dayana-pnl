"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

type CheckoutPaymentModalFrameProps = {
  ariaLabel: string;
  gradientBackground: string;
  header: ReactNode;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onBackdropClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

export const usePaymentModalScrollLock = (open: boolean): void => {
  useEffect(() => {
    if (!open) return;

    const prevBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.dispatchEvent(new Event("lenis-lock"));

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      window.dispatchEvent(new Event("lenis-unlock"));
    };
  }, [open]);
};

/** Altura máxima de la tarjeta según viewport real (teclado móvil, barras del sistema). */
const useCheckoutModalMaxHeight = (): string | undefined => {
  const [maxHeight, setMaxHeight] = useState<string | undefined>(undefined);

  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport;
      const viewportHeight = vv?.height ?? window.innerHeight;
      const isCompact = window.matchMedia("(max-width: 639px)").matches;
      const topGap = isCompact ? 10 : 20;
      const height = Math.max(280, Math.min(viewportHeight - topGap, viewportHeight * 0.92));
      setMaxHeight(`${Math.round(height)}px`);
    };

    update();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return maxHeight;
};

const CheckoutPaymentModalFrame = ({
  ariaLabel,
  gradientBackground,
  header,
  closeButtonRef,
  onClose,
  onBackdropClick,
  children,
}: CheckoutPaymentModalFrameProps) => {
  const maxHeight = useCheckoutModalMaxHeight();

  const modalStyle: CSSProperties | undefined = maxHeight
    ? { maxHeight }
    : { maxHeight: "min(92dvh, calc(100dvh - 1.25rem))" };

  return (
    <div
      aria-modal="true"
      role="dialog"
      aria-label={ariaLabel}
      data-lenis-prevent
      className="fixed inset-0 z-[101] flex items-end justify-center bg-black/80 p-0 backdrop-blur-md animate-[checkoutModalFadeIn_200ms_ease-out] sm:items-center sm:p-4 lg:p-6"
      onMouseDown={onBackdropClick}
    >
      <div
        data-lenis-prevent
        style={modalStyle}
        className="checkout-payment-modal relative flex w-full max-w-lg flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain rounded-t-2xl border border-linen/15 bg-ink text-white shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] animate-[checkoutModalPopIn_240ms_cubic-bezier(0.22,1,0.36,1)] sm:rounded-2xl"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-t-2xl opacity-80 sm:rounded-2xl"
          style={{ background: gradientBackground }}
        />

        <div className="checkout-payment-modal__header sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-linen/10 bg-ink/95 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur-md sm:px-6">
          {header}
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/60 transition-colors hover:bg-linen/10 hover:text-linen"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          data-lenis-prevent
          className="checkout-payment-modal__body relative z-10 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 sm:px-6"
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default CheckoutPaymentModalFrame;
