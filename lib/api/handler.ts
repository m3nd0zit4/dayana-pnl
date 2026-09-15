import type { StaffUser } from "@prisma/client";
import type { NextResponse } from "next/server";

import {
  requireBroadcastStaff,
  requireManualPaymentStaff,
  requireOwnerStaff,
  requireTestEmailStaff,
  requireWriteStaff,
  resolveAdminStaff,
} from "@/lib/auth/api-staff";

import { withResolver, type AuthedHandler } from "./handler-core";

export { apiError, readJson } from "./handler-core";

/**
 * Nivel de acceso de una ruta del CRM. Cada uno responde exactamente lo mismo
 * que su helper de `lib/auth/api-staff.ts`:
 * - `read`: sesión de staff; si no, 401 `UNAUTHORIZED`.
 * - `write`: además puede escribir; si no, 403 `read_only`.
 * - `owner`, `broadcast`, `manualPayment`, `testEmail`: 403 `forbidden`.
 */
export type StaffAccess =
  | "read"
  | "write"
  | "owner"
  | "broadcast"
  | "manualPayment"
  | "testEmail";

const RESOLVERS: Record<StaffAccess, () => Promise<StaffUser | NextResponse>> = {
  read: resolveAdminStaff,
  write: requireWriteStaff,
  owner: requireOwnerStaff,
  broadcast: requireBroadcastStaff,
  manualPayment: requireManualPaymentStaff,
  testEmail: requireTestEmailStaff,
};

/**
 * Handler de ruta con la comprobación de staff hecha.
 *
 * ```ts
 * export const DELETE = withStaff<{ id: string }>("write", async ({ staff, params }) => {
 *   ...
 * });
 * ```
 */
export const withStaff = <P = Record<string, never>>(
  access: StaffAccess,
  handler: AuthedHandler<StaffUser, P>
) => withResolver<StaffUser, P>(RESOLVERS[access], handler);
