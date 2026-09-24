"use client";

import { createContext, useContext } from "react";
import type { WhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import type { SaveState } from "./SaveIndicator";

export const WHATSAPP_AI_API = "/api/admin/settings/whatsapp-ai";

/** Pausa antes de guardar lo que se escribe; los clics se guardan al instante. */
export const TYPING_DELAY = 600;

export type LearningSummaryDto = {
  total: number;
  enabled: number;
  pendingEmbedding: number;
  imported: number;
  knownContacts: number;
  lastLearnedAt: string | null;
};

export type SettingsCtx = {
  config: WhatsAppAiConfig;
  /**
   * Cambia `path` de la configuración y lo guarda solo. `key` es el id del
   * ajuste (donde se pinta «Guardado»); `delay` > 0 para campos de texto.
   */
  change: (key: string, path: string, value: unknown, delay?: number) => void;
  states: Record<string, SaveState | undefined>;
  fail: (key: string, error: string) => void;
  /** Guardado automático contra otra ruta (p. ej. el saludo). */
  save: (key: string, url: string, body: Record<string, unknown>, delay?: number, merge?: boolean) => void;
  summary: LearningSummaryDto;
  setSummary: (summary: LearningSummaryDto) => void;
  /** Vista previa sin base de datos: se ve todo, no se guarda nada. */
  preview: boolean;
};

export const SettingsContext = createContext<SettingsCtx | null>(null);

export const useSettings = (): SettingsCtx => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings fuera de WhatsAppSettingsClient");
  return ctx;
};
