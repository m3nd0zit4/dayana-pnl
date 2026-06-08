"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

const AdminSignOut = () => (
  <button
    type="button"
    onClick={() => signOut({ callbackUrl: "/admin/sign-in" })}
    className="crm-btn-icon size-9 text-[var(--crm-muted)] hover:text-[var(--crm-danger)]"
    aria-label="Cerrar sesión"
    title="Cerrar sesión"
  >
    <LogOut className="size-[18px]" strokeWidth={1.75} />
  </button>
);

export default AdminSignOut;
