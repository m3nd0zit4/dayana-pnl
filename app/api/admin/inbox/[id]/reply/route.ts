import { NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { replyToConversation } from "@/lib/crm/conversations";
import { isMetaInboxEnabled } from "@/lib/meta/client";
import { MetaWindowError } from "@/lib/meta/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = async (req: Request, { params }: Params) => {
  if (!isMetaInboxEnabled()) {
    return NextResponse.json({ error: "inbox_disabled" }, { status: 404 });
  }

  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const input = payload as {
    body?: string;
    template?: { name: string; language: string; variables?: string[] } | null;
  };

  const text = input.body?.trim();
  if (!text) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

  try {
    const result = await replyToConversation({
      conversationId: id,
      body: text,
      staffUserId: staff.id,
      template: input.template ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    // La ventana cerrada es 409, no 500: no es un fallo del servidor sino una
    // regla de Meta, y la interfaz la explica en vez de mostrar un error genérico.
    if (e instanceof MetaWindowError) {
      return NextResponse.json(
        { error: e.message, window: e.window },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "send_failed" },
      { status: 502 }
    );
  }
};
