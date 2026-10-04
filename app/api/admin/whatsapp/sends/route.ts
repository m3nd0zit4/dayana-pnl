import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { createSend, listRecentSends, previewSend, WhatsAppSendSetupError } from "@/lib/crm/whatsapp-sends";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withStaff("read", async () => NextResponse.json({ items: await listRecentSends() }));

const schema = z.object({
  /** `preview` solo calcula; `create` deja el envío listo para ejecutarse. */
  action: z.enum(["preview", "create"]),
  contactIds: z.array(z.string()).min(1).max(2000),
  templateKey: z.string().max(120).nullish(),
  title: z.string().trim().max(200).default("Envío por WhatsApp"),
  kind: z.enum(["evento", "taller", "diagnostico", "pago", "libre", "comunidad"]).default("libre"),
  text: z.string().trim().max(4000).default(""),
  vars: z.record(z.string(), z.string().max(1000)).optional(),
  /** Vista previa: preguntar a 360dialog si la plantilla lleva imagen arriba. */
  checkHeader: z.boolean().optional(),
  /** Id del medio de WhatsApp de la imagen, de `POST …/sends/image`. */
  headerImageId: z.string().trim().min(1).max(200).nullish(),
});

export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const input = parsed.data;
  if (input.action === "preview") {
    return NextResponse.json(
      await previewSend({
        contactIds: input.contactIds,
        templateKey: input.templateKey,
        kind: input.kind,
        checkHeader: input.checkHeader,
      })
    );
  }
  if (!input.text && !input.templateKey) return apiError("empty_message", 400);
  try {
    const created = await createSend({
      title: input.title,
      kind: input.kind,
      text: input.text,
      templateKey: input.templateKey ?? null,
      vars: input.vars,
      contactIds: input.contactIds,
      staffId: staff.id,
      headerImageId: input.headerImageId ?? null,
    });
    return NextResponse.json(created);
  } catch (e) {
    // Imagen y plantilla no casan: el motivo, en español, para el diálogo.
    if (e instanceof WhatsAppSendSetupError) return apiError("send_blocked", 400, { message: e.message });
    throw e;
  }
});
