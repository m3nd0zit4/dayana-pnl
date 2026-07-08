import "@/lib/auth/ensure-dev-secret";
import { auth } from "@/auth";
import { verifyAdminMutationOrigin } from "@/lib/auth/csrf";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { NextResponse } from "next/server";

const MEMBER_PUBLIC_PAGES = new Set([
  "/miembros/crear-cuenta",
  "/miembros/recuperar",
]);

const MEMBER_PUBLIC_APIS = new Set([
  "/api/miembros/auth/set-password",
  "/api/miembros/auth/request-access",
  "/api/miembros/auth/signup",
]);

/** Rutas de acceso históricas — todas llevan al acceso único. */
const LEGACY_SIGN_IN_PATHS = new Set(["/admin/sign-in", "/miembros/acceso"]);

export const proxy = auth((req) => {
  if (isCrmUiPreview()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");
  const isMemberArea = pathname.startsWith("/miembros");
  const isMemberApi = pathname.startsWith("/api/miembros");
  const isSignIn = pathname === "/acceso" || LEGACY_SIGN_IN_PATHS.has(pathname);
  const kind = req.auth?.user?.kind;
  const isStaff = Boolean(req.auth?.user?.id) && kind === "staff";
  const isMember = Boolean(req.auth?.user?.id) && kind === "member";

  // Sesión activa en cualquier página de acceso → directo a su panel.
  if (isSignIn && isStaff) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
  }
  if (isSignIn && isMember) {
    return NextResponse.redirect(new URL("/miembros", req.nextUrl.origin));
  }
  if (LEGACY_SIGN_IN_PATHS.has(pathname)) {
    const acceso = new URL("/acceso", req.nextUrl.origin);
    req.nextUrl.searchParams.forEach((value, key) =>
      acceso.searchParams.set(key, value)
    );
    return NextResponse.redirect(acceso);
  }

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

  if (isAdmin && !isStaff) {
    const acceso = new URL("/acceso", req.nextUrl.origin);
    acceso.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search}`
    );
    return NextResponse.redirect(acceso);
  }

  if (isMemberArea && !isMember && !MEMBER_PUBLIC_PAGES.has(pathname)) {
    const acceso = new URL("/acceso", req.nextUrl.origin);
    acceso.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search}`
    );
    return NextResponse.redirect(acceso);
  }
});

export const config = {
  matcher: [
    "/acceso",
    "/admin/:path*",
    "/api/admin/:path*",
    "/miembros/:path*",
    "/api/miembros/:path*",
  ],
};
