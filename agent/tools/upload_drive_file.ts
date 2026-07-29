import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { shareFileWithLink, uploadFile } from "@/lib/google/drive";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";
import { accountLabel, resolveGoogleAccount } from "@/agent/lib/google";

export default defineTool({
  description:
    "Upload a text document to a connected Google Drive and optionally make it readable by anyone with the link. Use it to park something the operator wants to hand out — a workshop outline, a summary. It can only see files it created itself, so it cannot search or read the existing Drive; say so plainly rather than trying another tool. Never upload clinical notes or a contact's personal data with shareWithLink on: anyone the link reaches can open it.",
  inputSchema: z.object({
    name: z.string().trim().min(1).max(200).describe("Nombre del archivo, con extensión."),
    content: z.string().min(1).max(200_000).describe("Contenido en texto plano."),
    mimeType: z
      .string()
      .optional()
      .describe("Por defecto text/plain. Usa text/markdown o text/csv si aplica."),
    shareWithLink: z
      .boolean()
      .optional()
      .describe("Deja el archivo abierto para cualquiera que tenga el enlace."),
    accountId: z.string().optional(),
  }),
  approval: always(),
  async execute({ name, content, mimeType, shareWithLink, accountId }, ctx) {
    requireWriteStaff(ctx);

    const { account, token } = await resolveGoogleAccount("DRIVE", accountId);

    const file = await uploadFile(token, {
      name,
      mimeType: mimeType ?? "text/plain",
      content,
    });

    if (shareWithLink) await shareFileWithLink(token, file.id);

    await auditAgentWrite(ctx, {
      action: "GOOGLE_DRIVE_FILE_UPLOADED",
      entityType: "GoogleDriveFile",
      entityId: file.id,
      changes: {
        account: accountLabel(account),
        name,
        bytes: content.length,
        public: Boolean(shareWithLink),
      },
    });

    return {
      fileId: file.id,
      name: file.name,
      account: accountLabel(account),
      link: file.webViewLink ?? null,
      shared: Boolean(shareWithLink),
      note: shareWithLink
        ? "Cualquiera con el enlace puede abrirlo, también si se reenvía."
        : "Solo visible desde esa cuenta de Google.",
    };
  },
});
