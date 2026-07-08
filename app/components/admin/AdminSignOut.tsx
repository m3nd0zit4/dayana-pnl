"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/app/components/ui/button";

const AdminSignOut = () => (
  <Button
    variant="ghost"
    size="icon"
    onClick={() => signOut({ callbackUrl: "/acceso" })}
    className="text-muted-foreground hover:text-destructive"
    aria-label="Cerrar sesión"
    title="Cerrar sesión"
  >
    <LogOut />
  </Button>
);

export default AdminSignOut;
