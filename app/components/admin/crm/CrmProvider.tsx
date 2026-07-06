"use client";

import type { StaffRole } from "@prisma/client";
import { useRouter } from "next/navigation";
import { toast as sonnerToast } from "sonner";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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

type CrmContextValue = {
  role: StaffRole | "PREVIEW";
  preview: boolean;
  canWrite: boolean;
  canEditNotes: boolean;
  canManageTeam: boolean;
  /** true cuando GEMINI_API_KEY está configurada — habilita el autocompletado con IA. */
  aiEnabled: boolean;
  focusMode: boolean;
  setFocusMode: (active: boolean) => void;
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
  if (variant === "loading") return Infinity;
  if (variant === "info") return 8000;
  if (variant === "error") return 6000;
  return 4000;
};

const sonnerVariantFn = (variant: ToastVariant) => {
  if (variant === "error") return sonnerToast.error;
  if (variant === "info") return sonnerToast.info;
  if (variant === "loading") return sonnerToast.loading;
  return sonnerToast.success;
};

const CrmProvider = ({
  children,
  role,
  preview,
  aiEnabled = false,
}: {
  children: ReactNode;
  role: StaffRole | "PREVIEW";
  preview: boolean;
  aiEnabled?: boolean;
}) => {
  const router = useRouter();
  // confirmState holds the last content (never cleared on close) so the
  // dialog keeps showing it while AlertDialog's close animation plays;
  // confirmOpen alone drives visibility.
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const dismissToast = useCallback((id: number) => {
    sonnerToast.dismiss(id);
  }, []);

  const toast = useCallback(
    (input: string | ToastOptions, variantArg: ToastVariant = "success"): number => {
      const opts: ToastOptions =
        typeof input === "string" ? { message: input, variant: variantArg } : input;
      const variant = opts.variant ?? "success";
      const duration = opts.duration ?? defaultDuration(variant);

      const id = sonnerVariantFn(variant)(opts.title ?? opts.message, {
        description: opts.title ? opts.message : undefined,
        duration,
        action: opts.action
          ? {
              label: opts.action.label,
              onClick: () => router.push(opts.action!.href),
            }
          : undefined,
      });

      return id as number;
    },
    [router]
  );

  const confirm = useCallback(
    (opts: { title: string; message: string; onConfirm: () => void | Promise<void> }) => {
      setConfirmState(opts);
      setConfirmOpen(true);
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
      aiEnabled: preview ? false : aiEnabled,
      focusMode,
      setFocusMode,
      toast,
      dismissToast,
      confirm,
    }),
    [role, preview, staffRole, aiEnabled, focusMode, toast, dismissToast, confirm]
  );

  return (
    <CrmContext.Provider value={value}>
      {children}
      <CrmConfirmDialog
        open={confirmOpen}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const handler = confirmState?.onConfirm;
          setConfirmOpen(false);
          if (handler) await handler();
        }}
      />
    </CrmContext.Provider>
  );
};

export default CrmProvider;
