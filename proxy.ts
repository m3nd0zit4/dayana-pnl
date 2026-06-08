import "@/lib/auth/ensure-dev-secret";
import { auth } from "@/auth";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  if (isCrmUiPreview()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");
  const isSignIn = pathname === "/admin/sign-in";

  if ((isAdmin || isAdminApi) && !isSignIn && !req.auth) {
    const signIn = new URL("/admin/sign-in", req.nextUrl.origin);
    signIn.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search}`
    );
    return NextResponse.redirect(signIn);
  }

  if (isSignIn && req.auth) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
