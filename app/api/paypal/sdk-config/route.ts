import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json(
      {
        error: "missing_client_id",
        message: "Falta NEXT_PUBLIC_PAYPAL_CLIENT_ID.",
      },
      { status: 503 }
    );
  }

  const mode = process.env.PAYPAL_MODE?.trim().toLowerCase();
  const environment = mode === "live" ? "production" : "sandbox";

  return NextResponse.json(
    { clientId, environment },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
