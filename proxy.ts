import "@/lib/auth/ensure-dev-secret";
import { auth } from "@/auth";
import { verifyAdminMutationOrigin } from "@/lib/auth/csrf";
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
  const staffId = req.auth?.user?.id;
  const isAuthenticated = Boolean(staffId);

  if (isAdminApi && !isAuthenticated) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (isAdminApi && isAuthenticated && !verifyAdminMutationOrigin(req)) {
    return NextResponse.json({ error: "FORBIDDEN_ORIGIN" }, { status: 403 });
  }

  if ((isAdmin || isAdminApi) && !isSignIn && !isAuthenticated) {
    const signIn = new URL("/admin/sign-in", req.nextUrl.origin);
    signIn.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search}`
    );
    return NextResponse.redirect(signIn);
  }

  if (isSignIn && isAuthenticated) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
