import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  ReceiptError,
  buildReceiptData,
  receiptFilename,
  renderReceiptPdf,
} from "@/lib/payments/receipt";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * El recibo de un pago, en PDF.
 *
 * Se genera al vuelo en vez de guardarse: el documento se deriva por completo
 * del pago y de la matrícula, así que almacenarlo sería mantener una copia que
 * puede quedar desfasada del dato del que salió. Lo único que sí se guarda es
 * el NÚMERO, porque ése tiene que ser el mismo cada vez que se descargue.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await ctx.params;

  try {
    const data = await buildReceiptData(id);
    const pdf = await renderReceiptPdf(data);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        // `inline` y no `attachment`: el panel lo abre en una pestaña para
        // mirarlo, y el navegador sigue ofreciendo descargarlo desde ahí. Al
        // revés no se puede — un `attachment` no se deja previsualizar.
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
