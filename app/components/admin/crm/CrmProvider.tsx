"use client";

import type { StaffRole } from "@prisma/client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  canWriteCrm,
  canEditClinicalNotes,
  canManageTeam,
} from "@/lib/crm/staff-permissions";
import CrmConfirmDialog from "./CrmConfirmDialog";

export type ToastVariant = "success" | "error" | "info" | "loading";

export type ToastOptions = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  duration?: number;
  action?: { label: string; href: string };
};

type Toast = ToastOptions & {
  id: number;
  variant: ToastVariant;
  duration: number;
};

type CrmContextValue = {
  role: StaffRole | "PREVIEW";
  preview: boolean;
  canWrite: boolean;
  canEditNotes: boolean;
  canManageTeam: boolean;
  toast: {
    (message: string, variant?: ToastVariant): number;
    (options: ToastOptions): number;
  };
  dismissToast: (id: number) => void;
  confirm: (opts: {
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  }) => void;
};

const CrmContext = createContext<CrmContextValue | null>(null);

export const useCrm = () => {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error("useCrm must be used within CrmProvider");
  return ctx;
};

const defaultDuration = (variant: ToastVariant) => {
  if (variant === "loading") return 0;
  if (variant === "info") return 8000;
  if (variant === "error") return 6000;
  return 4000;
};

const toastStyles: Record<ToastVariant, string> = {
  success:
    "border-[var(--crm-border)] bg-white text-[var(--crm-foreground)]",
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-sky-200 bg-sky-50 text-sky-950",
  loading: "border-[var(--crm-border)] bg-white text-[var(--crm-foreground)]",
};

const CrmProvider = ({
  children,
  role,
  preview,
}: {
  children: ReactNode;
  role: StaffRole | "PREVIEW";
  preview: boolean;
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const dismissToast = useCallback((id: number) => {
    const t = timeoutsRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timeoutsRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (input: string | ToastOptions, variantArg: ToastVariant = "success"): number => {
      const opts: ToastOptions =
        typeof input === "string" ? { message: input, variant: variantArg } : input;
      const variant = opts.variant ?? "success";
      const duration = opts.duration ?? defaultDuration(variant);
      const id = Date.now() + Math.floor(Math.random() * 1000);

      setToasts((prev) => [
        ...prev,
        {
          id,
          title: opts.title,
          message: opts.message,
          variant,
          duration,
          action: opts.action,
        },
      ]);

      if (duration > 0) {
        const timeout = setTimeout(() => dismissToast(id), duration);
        timeoutsRef.current.set(id, timeout);
      }

      return id;
    },
    [dismissToast]
  );

  const confirm = useCallback(
    (opts: { title: string; message: string; onConfirm: () => void | Promise<void> }) => {
      setConfirmState(opts);
    },
    []
  );

  const staffRole = role === "PREVIEW" ? "READONLY" : role;

  const value = useMemo<CrmContextValue>(
    () => ({
      role,
      preview,
      canWrite: preview ? false : canWriteCrm(staffRole),
      canEditNotes: preview ? false : canEditClinicalNotes(staffRole),
      canManageTeam: preview ? false : canManageTeam(staffRole),
      toast,
      dismissToast,
      confirm,
    }),
    [role, preview, staffRole, toast, dismissToast, confirm]
  );

  return (
    <CrmContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg ${toastStyles[t.variant]}`}
          >
            <div className="flex items-start gap-2">
              {t.variant === "loading" && (
                <Loader2
                  className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--crm-accent)]"
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1">
                {t.title && (
                  <p className="font-semibold leading-snug">{t.title}</p>
                )}
                <p className={t.title ? "mt-0.5 text-[13px] leading-snug opacity-90" : ""}>
                  {t.message}
                </p>
                {t.action && (
                  <Link
                    href={t.action.href}
                    className="mt-2 inline-block text-xs font-medium text-[var(--crm-accent)] underline"
                    onClick={() => dismissToast(t.id)}
                  >
                    {t.action.label}
                  </Link>
                )}
              </div>
              {(t.variant === "loading" || t.duration === 0) && (
                <button
                  type="button"
                  className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--crm-muted)] hover:text-[var(--crm-foreground)]"
                  onClick={() => dismissToast(t.id)}
                  aria-label="Cerrar aviso"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {confirmState && (
        <CrmConfirmDialog
          open
          title={confirmState.title}
          message={confirmState.message}
          onClose={() => setConfirmState(null)}
          onConfirm={async () => {
            await confirmState.onConfirm();
            setConfirmState(null);
          }}
        />
      )}
    </CrmContext.Provider>
  );
};

export default CrmProvider;
