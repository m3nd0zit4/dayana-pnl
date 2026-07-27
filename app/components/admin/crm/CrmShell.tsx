"use client";

import type { StaffRole } from "@prisma/client";
import Link from "next/link";
import { Settings } from "lucide-react";
import type { CSSProperties } from "react";
import AdminPreviewBanner from "@/app/components/admin/AdminPreviewBanner";
import AgentAskPill from "@/app/components/admin/crm/agent-panel/AgentAskPill";
import AgentPanel from "@/app/components/admin/crm/agent-panel/AgentPanel";
import AgentThreadsMenuSection from "@/app/components/admin/crm/AgentThreadsMenuSection";
import CrmBottomNav from "@/app/components/admin/crm/CrmBottomNav";
import CrmMenu from "@/app/components/admin/crm/CrmMenu";
import CrmNavBar from "@/app/components/admin/crm/CrmNavBar";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/app/components/ui/sidebar";

/** Lives inside SidebarProvider so it can close the mobile drawer on nav. */
const CrmMenuWithAutoClose = () => {
  const { setOpenMobile } = useSidebar();
  return <CrmMenu onNavigate={() => setOpenMobile(false)} />;
};

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
  const { focusMode, agentEnabled, agentPanelOpen, agentPanelExpanded } = useCrm();
  const panelTakingOver = agentEnabled && agentPanelOpen && agentPanelExpanded;

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
      className="crm-app h-[100dvh] min-h-0 flex-col"
    >
      <CrmNavBar
        displayName={displayName}
        role={role}
        avatarUrl={avatarUrl}
        preview={preview}
      />

      <div className="min-h-0 flex-1 bg-[var(--crm-topbar)] p-2">
        <div className="h-full min-h-0 rounded-xl bg-card shadow-sm">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl [transform:translateZ(0)]">
            <div className="flex min-h-0 flex-1">
              <Sidebar
                collapsible="offcanvas"
                className="top-0 bottom-0 h-auto border-r border-sidebar-border"
              >
                <SidebarContent>
                  <CrmMenuWithAutoClose />
                  {agentEnabled && <AgentThreadsMenuSection />}
                </SidebarContent>
                <SidebarFooter>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip="Configuración" render={<Link href="/admin/ajustes" />}>
                        <Settings />
                        <span>Configuración</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarFooter>
              </Sidebar>

              <SidebarInset
                className={cn(
                  "min-w-0 overflow-hidden bg-transparent",
                  panelTakingOver && "hidden"
                )}
              >
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

              {agentEnabled && <AgentPanel />}
              {agentEnabled && <AgentAskPill />}
            </div>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default CrmShell;
