import { NextRequest, NextResponse } from "next/server";
import { getMemberSession } from "@/lib/auth/member-session";
import { prisma } from "@/lib/db";
import {
  ReceiptError,
  buildReceiptData,
  receiptFilename,
  renderReceiptPdf,
} from "@/lib/payments/receipt";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * El recibo de un pago, para la persona que lo pagó.
 *
 * Gemelo de `/api/admin/payments/[id]/receipt`, con una diferencia que es toda
 * la razón de que sea una ruta aparte: aquí se comprueba que el pago
 * pertenezca al contacto de la sesión. Sin esa comprobación, un id ajeno —y un
 * `cuid` no es secreto: viaja en enlaces y en correos— serviría el comprobante
 * de otra clienta, con su nombre, su correo y lo que pagó.
 *
 * La comprobación va en la CONSULTA (`enrollment.contactId`), no en un `if`
 * posterior sobre el resultado: así un pago que no es suyo simplemente no
 * existe para esta ruta, y no hay forma de que un cambio futuro se salte el
 * filtro por accidente.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const member = await getMemberSession();
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const owned = await prisma.payment.findFirst({
    where: { id, enrollment: { contactId: member.contact.id } },
    select: { id: true },
  });

  // Mismo 404 que un pago inexistente, a propósito: un 403 confirmaría que ese
  // id existe y es de otra persona.
  if (!owned) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const data = await buildReceiptData(id);
    const pdf = await renderReceiptPdf(data);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${receiptFilename(
          data.receiptNumber
        )}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ReceiptError) {
      return NextResponse.json(
        { error: e.code, message: e.message },
        { status: e.code === "NOT_FOUND" ? 404 : 409 }
      );
    }
    throw e;
  }
}
