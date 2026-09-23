import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";
import { resumeAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { applyConfigPatch } from "@/lib/crm/whatsapp-agent/config-patch";
import { setMemory } from "@/lib/crm/whatsapp-agent/memory";
import { playbookSchema, upsertPlaybook } from "@/lib/crm/whatsapp-agent/playbooks";

export const dynamic = "force-dynamic";

const proposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("config"), patch: z.record(z.string(), z.unknown()) }),
  z.object({
    type: z.literal("playbook"),
    playbook: playbookSchema.extend({ id: z.string().optional() }),
  }),
  z.object({
    type: z.literal("memory"),
    phone: z.string().regex(/^\d{6,20}$/),
    notes: z.string().max(1500),
  }),
  z.object({
    type: z.literal("chat_mode"),
    conversationId: z.string(),
    mode: z.enum(["AUTO", "COPILOT", "MANUAL"]),
    priority: z.boolean().optional(),
  }),
]);

/** Dayana tocó «Aplicar» en una propuesta del asistente. */
export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = proposalSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const p = parsed.data;

  const audit = (entityType: string, entityId: string, changes: unknown) =>
    fireAuditLog({ staffUserId: staff.id, action: "UPDATE", entityType, entityId, changes });

  switch (p.type) {
    case "config": {
      const result = await applyConfigPatch(p.patch);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      audit("WhatsAppAiConfig", "whatsapp.ai", { changed: result.changed, via: "assistant" });
      return NextResponse.json({ ok: true, changed: result.changed });
    }
    case "playbook": {
      const row = await upsertPlaybook({ ...p.playbook, isEnabled: true, source: "manual" });
      audit("WhatsAppPlaybook", row.id, { name: row.name, via: "assistant" });
      return NextResponse.json({ ok: true, id: row.id });
    }
    case "memory": {
      await setMemory(p.phone, p.notes);
      audit("WhatsAppMemory", p.phone, { via: "assistant" });
      return NextResponse.json({ ok: true });
    }
    case "chat_mode": {
      await prisma.conversation.update({
        where: { id: p.conversationId },
        data: {
          aiMode: p.mode,
          ...(p.priority === undefined ? {} : { priorityAt: p.priority ? new Date() : null }),
        },
      });
      if (p.mode !== "MANUAL") await resumeAutoReply(p.conversationId);
      audit("WhatsAppChat", p.conversationId, { aiMode: p.mode, priority: p.priority, via: "assistant" });
      return NextResponse.json({ ok: true });
    }
  }
});
