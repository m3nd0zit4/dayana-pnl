"use client";

import type { StaffRole } from "@prisma/client";
import type { CSSProperties } from "react";
import AdminPreviewBanner from "@/app/components/admin/AdminPreviewBanner";
import CrmBottomNav from "@/app/components/admin/crm/CrmBottomNav";
import CrmLogo from "@/app/components/admin/crm/CrmLogo";
import CrmMenu from "@/app/components/admin/crm/CrmMenu";
import CrmNavBar from "@/app/components/admin/crm/CrmNavBar";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@/app/components/ui/sidebar";

const CrmShell = ({
  children,
  displayName,
  role,
  avatarUrl,
  preview,
}: {
  children: React.ReactNode;
  displayName: string;
  role: StaffRole | "PREVIEW";
  avatarUrl: string | null;
  preview: boolean;
}) => {
  const { focusMode } = useCrm();

  if (focusMode) {
    return (
      <div className="crm-app flex h-[100dvh] min-h-0 flex-col">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": "13.5rem" } as CSSProperties}
      className="crm-app min-h-0"
    >
      <Sidebar
        collapsible="offcanvas"
        className="border-r border-border"
      >
        <SidebarHeader>
          <CrmLogo />
        </SidebarHeader>
        <SidebarContent>
          <CrmMenu />
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-hidden bg-transparent">
        <CrmNavBar
          displayName={displayName}
          role={role}
          avatarUrl={avatarUrl}
          preview={preview}
        />
        <main className="crm-main-scroll crm-main-with-bottom-nav flex min-h-0 flex-1 flex-col overflow-y-auto">
          {preview && (
            <div className="px-4 pt-3 md:px-5 lg:px-6">
              <AdminPreviewBanner />
            </div>
          )}
          {children}
        </main>
        <div className="lg:hidden">
          <CrmBottomNav />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default CrmShell;
