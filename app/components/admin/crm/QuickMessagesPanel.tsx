"use client";

import { ChevronDown, Copy } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { renderQuickMessage } from "@/lib/crm/render-message";
import { isQuickMessageTemplate } from "@/lib/crm/quick-message-templates";
import { useCrm } from "./CrmProvider";

export type QuickMessageTemplate = {
  id: string;
  title: string;
  body: string;
};

type Vars = Record<string, string>;

type Props = {
  vars: Vars;
  preview?: boolean;
};

const QuickMessagesPanel = ({ vars, preview }: Props) => {
  const { toast } = useCrm();
  const [templates, setTemplates] = useState<QuickMessageTemplate[]>([]);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (preview) {
      setTemplates([]);
      return;
    }
    fetch("/api/admin/messages/templates")
      .then((r) => r.json())
      .then((d) =>
        setTemplates(
          (d.templates ?? [])
            .filter((t: { key: string }) => isQuickMessageTemplate(t.key))
            .map(
              (t: { id: string; title?: string; key: string; body: string }) => ({
                id: t.id,
                title: t.title?.trim() || t.key.replace(/-/g, " "),
                body: t.body,
              })
            )
        )
      )
      .catch(() => {});
  }, [preview]);

  const copyMessage = async (body: string) => {
    const text = renderQuickMessage(body, vars);
    try {
      await navigator.clipboard.writeText(text);
      toast("Mensaje copiado — pégalo en WhatsApp");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  if (templates.length === 0) return null;

  return (
    <div className="space-y-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left transition-colors hover:text-[var(--crm-foreground)]"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="crm-font-display text-[10px] text-[var(--crm-muted)]">
          Mensajes rápidos
          <span className="ml-2 font-[font1] normal-case tracking-normal text-[var(--crm-muted)]/80">
            ({templates.length})
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-[var(--crm-muted)] transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {expanded ? (
        <ul id={panelId} className="mt-3 space-y-2">
          {templates.map((t) => {
            const previewText = renderQuickMessage(t.body, vars);
            return (
              <li
                key={t.id}
                className="rounded-xl border border-[var(--crm-border)] bg-white/70 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--crm-foreground)]">
                    {t.title}
                  </span>
                  <button
                    type="button"
                    className="crm-btn-ghost shrink-0 inline-flex items-center gap-1 text-xs"
                    onClick={() => void copyMessage(t.body)}
                  >
                    <Copy className="size-3.5" />
                    Copiar
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[var(--crm-muted)]">
                  {previewText}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

export default QuickMessagesPanel;
