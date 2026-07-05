import "@/lib/auth/ensure-dev-secret";
import { auth } from "@/auth";
import { verifyAdminMutationOrigin } from "@/lib/auth/csrf";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { NextResponse } from "next/server";

const MEMBER_PUBLIC_PAGES = new Set([
  "/miembros/acceso",
  "/miembros/crear-cuenta",
  "/miembros/recuperar",
]);

const MEMBER_PUBLIC_APIS = new Set([
  "/api/miembros/auth/set-password",
  "/api/miembros/auth/request-access",
]);

export const proxy = auth((req) => {
  if (isCrmUiPreview()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");
  const isMemberArea = pathname.startsWith("/miembros");
  const isMemberApi = pathname.startsWith("/api/miembros");
  const isSignIn = pathname === "/admin/sign-in";
  const kind = req.auth?.user?.kind;
  const isStaff = Boolean(req.auth?.user?.id) && kind === "staff";
  const isMember = Boolean(req.auth?.user?.id) && kind === "member";

  // Members never touch the CRM; staff never touch the member portal.
  if (isMember && isAdminApi) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (isMember && isAdmin) {
    return NextResponse.redirect(new URL("/miembros", req.nextUrl.origin));
  }
  if (isStaff && isMemberApi) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (isStaff && isMemberArea) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
  }

  if (isAdminApi && !isStaff) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (isMemberApi && !isMember && !MEMBER_PUBLIC_APIS.has(pathname)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if ((isAdminApi || isMemberApi) && !verifyAdminMutationOrigin(req)) {
    return NextResponse.json({ error: "FORBIDDEN_ORIGIN" }, { status: 403 });
  }

  if (isAdmin && !isSignIn && !isStaff) {
    const signIn = new URL("/admin/sign-in", req.nextUrl.origin);
    signIn.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search}`
    );
    return NextResponse.redirect(signIn);
  }

  if (isSignIn && isStaff) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
  }

  if (isMemberArea && !isMember && !MEMBER_PUBLIC_PAGES.has(pathname)) {
    const acceso = new URL("/miembros/acceso", req.nextUrl.origin);
    acceso.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search}`
    );
    return NextResponse.redirect(acceso);
  }

  if (isMember && pathname === "/miembros/acceso") {
    return NextResponse.redirect(new URL("/miembros", req.nextUrl.origin));
  }
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/miembros/:path*",
    "/api/miembros/:path*",
  ],
};
