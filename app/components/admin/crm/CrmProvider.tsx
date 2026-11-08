"use client";

import type { StaffRole } from "@prisma/client";
import type { AgentId } from "@/agent/lib/catalog";
import { useRouter } from "next/navigation";
import { toast as sonnerToast } from "sonner";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  canWriteCrm,
  canManageTeam,
  canRecordManualPayments,
} from "@/lib/crm/staff-permissions";
import CrmConfirmDialog from "./CrmConfirmDialog";
import AgentMessageParam, { type AgentMessageSeed } from "./agent-panel/AgentMessageParam";
import NewVersionNotice from "./NewVersionNotice";

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
  | { type: "message"; value: string; files?: File[]; agent?: AgentId }
  | { type: "thread"; value: string }
  /** A fresh conversation with this agent; `keepIfSame` keeps the open one if it's already that agent's. */
  | { type: "new"; agent: AgentId; keepIfSame?: boolean }
  /** The assistant started this conversation (`?agentMessage=<key>`): reopen its thread, or start it with that message. */
  | { type: "opener"; seed: AgentMessageSeed };

type CrmContextValue = {
  role: StaffRole | "PREVIEW";
  preview: boolean;
  canWrite: boolean;
  canManageTeam: boolean;
  /**
   * Puede registrar pagos manuales (OWNER y OPERATOR). Es más estrecho que
   * `canWrite`: un DEVELOPER escribe en el CRM pero la API de pagos manuales le
   * responde 403, así que el botón no se le pinta.
   */
  canRecordPayments: boolean;
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
  /**
   * Abre el panel del agente y envía este mensaje en una conversación nueva:
   * con `agent` si se pasa, si no con el asistente general ("auto"), que reparte.
   */
  askAgent: (message: string, files?: File[], options?: { agent?: AgentId }) => void;
  /** Abre el panel en una conversación nueva que empieza con este mensaje del asistente (p. ej. desde un chat de WhatsApp). */
  openAgentMessage: (seed: AgentMessageSeed) => void;
  /** Abre el panel en una conversación nueva con ese agente (con `keepIfSame`, deja la abierta si ya es suya). */
  startAgentConversation: (agent: AgentId, options?: { keepIfSame?: boolean }) => void;
  /** Abre el panel del agente sobre un hilo existente (p.ej. desde la lista del sidebar). */
  openAgentThread: (threadId: string) => void;
  toast: {
    (message: string, variant?: ToastVariant): number;
    (options: ToastOptions): number;
  };
  dismissToast: (id: number) => void;
  confirm: (opts: ConfirmOptions) => void;
};

export type ConfirmOptions = {
  title: string;
  message: string;
  /** Verbo de la acción: «Eliminar», «Revocar»… Evita el genérico «Confirmar». */
  confirmLabel?: string;
  /** Tiñe el botón de confirmar. Para todo lo que borra o revoca. */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
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
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentPanelExpanded, setAgentPanelExpanded] = useState(false);
  const [pendingAgentAction, setPendingAgentAction] = useState<PendingAgentAction | null>(null);

  const askAgent = useCallback((message: string, files?: File[], options?: { agent?: AgentId }) => {
    setPendingAgentAction({ type: "message", value: message, files, agent: options?.agent });
    setAgentPanelOpen(true);
  }, []);

  const startAgentConversation = useCallback((agent: AgentId, options?: { keepIfSame?: boolean }) => {
    setPendingAgentAction({ type: "new", agent, keepIfSame: options?.keepIfSame });
    setAgentPanelOpen(true);
  }, []);

  const openAgentThread = useCallback((threadId: string) => {
    setPendingAgentAction({ type: "thread", value: threadId });
    setAgentPanelOpen(true);
  }, []);

  const clearPendingAgentAction = useCallback(() => setPendingAgentAction(null), []);

  const openAgentMessage = useCallback((seed: AgentMessageSeed) => {
    setPendingAgentAction({ type: "opener", seed });
    setAgentPanelOpen(true);
  }, []);

  const agentMessageMissing = useCallback(() => {
    sonnerToast.error("No encontré ese mensaje del asistente", { duration: defaultDuration("error") });
  }, []);

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

  const confirm = useCallback((opts: ConfirmOptions) => {
    setConfirmState(opts);
    setConfirmOpen(true);
  }, []);

  const staffRole = role === "PREVIEW" ? "READONLY" : role;

  const value = useMemo<CrmContextValue>(
    () => ({
      role,
      preview,
      canWrite: preview ? false : canWriteCrm(staffRole),
      canManageTeam: preview ? false : canManageTeam(staffRole),
      canRecordPayments: preview ? false : canRecordManualPayments(staffRole),
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
      openAgentMessage,
      startAgentConversation,
      openAgentThread,
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
      openAgentMessage,
      startAgentConversation,
      openAgentThread,
      toast,
      dismissToast,
      confirm,
    ]
  );

  return (
    <CrmContext.Provider value={value}>
      {children}
      {!preview && <NewVersionNotice />}
      {value.agentEnabled && (
        <Suspense fallback={null}>
          <AgentMessageParam onSeed={openAgentMessage} onMissing={agentMessageMissing} />
        </Suspense>
      )}
      <CrmConfirmDialog
        open={confirmOpen}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel}
        destructive={confirmState?.destructive}
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
