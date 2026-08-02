import "@/lib/auth/ensure-dev-secret";
import { auth } from "@/auth";
import { verifyAdminMutationOrigin } from "@/lib/auth/csrf";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { NextResponse } from "next/server";

const MEMBER_PUBLIC_PAGES = new Set([
  "/miembros/crear-cuenta",
  "/miembros/recuperar",
]);

/** Where a member with no real phone (Google/email signup) must land before
 *  anything else in the portal — onboarding isn't done until this is filled. */
const MEMBER_PROFILE_GATE_PATH = "/miembros/completar-perfil";

const MEMBER_PUBLIC_APIS = new Set([
  "/api/miembros/auth/set-password",
  "/api/miembros/auth/request-access",
  "/api/miembros/auth/signup",
  "/api/miembros/auth/email-status",
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
  // OWNER-only exception to "staff never touch the member portal": lets the
  // owner browse /miembros (courses, workshops) via lib/auth/portal-viewer.ts's
  // read-only bridge. Every other staff role stays fully blocked, unchanged.
  const isOwnerStaff = isStaff && req.auth?.user?.role === "OWNER";

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

  // Members never touch the CRM; staff never touch the member portal
  // (except OWNER, see isOwnerStaff above).
  if (isMember && isAdminApi) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (isMember && isAdmin) {
    return NextResponse.redirect(new URL("/miembros", req.nextUrl.origin));
  }
  if (isStaff && isMemberApi && !isOwnerStaff) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (isStaff && isMemberArea && !isOwnerStaff) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
  }

  if (isAdminApi && !isStaff) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (isMemberApi && !isMember && !isOwnerStaff && !MEMBER_PUBLIC_APIS.has(pathname)) {
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

  if (
    isMemberArea &&
    !isMember &&
    !isOwnerStaff &&
    !MEMBER_PUBLIC_PAGES.has(pathname)
  ) {
    const acceso = new URL("/acceso", req.nextUrl.origin);
    acceso.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search}`
    );
    return NextResponse.redirect(acceso);
  }

  // Onboarding isn't done until a real phone is on file — Google/email
  // signup skip that step entirely (Google never asks for it; the legacy
  // request-access path can create a placeholder-phone lead too). Applies
  // only inside /miembros: workshop/course checkout pages live outside this
  // matcher and already collect the phone themselves via the payment modal's
  // contact-form fallback, so a member mid-checkout is never redirected here.
  if (
    isMemberArea &&
    isMember &&
    req.auth?.user?.needsPhone &&
    pathname !== MEMBER_PROFILE_GATE_PATH
  ) {
    const gate = new URL(MEMBER_PROFILE_GATE_PATH, req.nextUrl.origin);
    gate.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(gate);
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
