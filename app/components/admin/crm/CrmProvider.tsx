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

/** What the agent panel should do the next time it (re)mounts a session. */
export type PendingAgentAction =
  | { type: "message"; value: string; files?: File[] }
  | { type: "thread"; value: string };

type CrmContextValue = {
  role: StaffRole | "PREVIEW";
  preview: boolean;
  canWrite: boolean;
  canEditNotes: boolean;
  canManageTeam: boolean;
  /** true cuando el agente CRM (eve) está habilitado para este staff — ver CRM_AGENT_ENABLED. */
  agentEnabled: boolean;
  /**
   * true cuando la campana puede abrir el stream SSE — ver
   * NOTIFICATIONS_STREAM_ENABLED. En false el feed se degrada a sondeo; es el
   * interruptor de emergencia si el coste del stream se dispara.
   */
  streamEnabled: boolean;
  metaInboxEnabled: boolean;
  socialPublishingEnabled: boolean;
  agentPanelOpen: boolean;
  setAgentPanelOpen: (open: boolean) => void;
  agentPanelExpanded: boolean;
  setAgentPanelExpanded: (expanded: boolean) => void;
  /** Acción pendiente para el panel: sembrar un mensaje nuevo o cambiar a un hilo existente. */
  pendingAgentAction: PendingAgentAction | null;
  clearPendingAgentAction: () => void;
  /** Abre el panel del agente y envía este mensaje en una conversación nueva. */
  askAgent: (message: string, files?: File[]) => void;
  /** Abre el panel del agente sobre un hilo existente (p.ej. desde la lista del sidebar). */
  openAgentThread: (threadId: string) => void;
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
  agentEnabled = false,
  streamEnabled = false,
  metaInboxEnabled = false,
  socialPublishingEnabled = false,
}: {
  children: ReactNode;
  role: StaffRole | "PREVIEW";
  preview: boolean;
  agentEnabled?: boolean;
  streamEnabled?: boolean;
  metaInboxEnabled?: boolean;
  socialPublishingEnabled?: boolean;
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
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentPanelExpanded, setAgentPanelExpanded] = useState(false);
  const [pendingAgentAction, setPendingAgentAction] = useState<PendingAgentAction | null>(null);

  const askAgent = useCallback((message: string, files?: File[]) => {
    setPendingAgentAction({ type: "message", value: message, files });
    setAgentPanelOpen(true);
  }, []);

  const openAgentThread = useCallback((threadId: string) => {
    setPendingAgentAction({ type: "thread", value: threadId });
    setAgentPanelOpen(true);
  }, []);

  const clearPendingAgentAction = useCallback(() => setPendingAgentAction(null), []);

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
      agentEnabled: preview ? false : agentEnabled,
      streamEnabled: preview ? false : streamEnabled,
      metaInboxEnabled: preview ? false : metaInboxEnabled,
      socialPublishingEnabled: preview ? false : socialPublishingEnabled,
      agentPanelOpen,
      setAgentPanelOpen,
      agentPanelExpanded,
      setAgentPanelExpanded,
      pendingAgentAction,
      clearPendingAgentAction,
      askAgent,
      openAgentThread,
      focusMode,
      setFocusMode,
      toast,
      dismissToast,
      confirm,
    }),
    [
      role,
      preview,
      staffRole,
      agentEnabled,
      streamEnabled,
      metaInboxEnabled,
      socialPublishingEnabled,
      agentPanelOpen,
      agentPanelExpanded,
      pendingAgentAction,
      clearPendingAgentAction,
      askAgent,
      openAgentThread,
      focusMode,
      toast,
      dismissToast,
      confirm,
    ]
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
