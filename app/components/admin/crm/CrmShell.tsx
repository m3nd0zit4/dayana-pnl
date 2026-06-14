"use client";

import { useCallback, useEffect, useState } from "react";
import type { StaffRole } from "@prisma/client";
import AdminPreviewBanner from "@/app/components/admin/AdminPreviewBanner";
import CrmBottomNav from "@/app/components/admin/crm/CrmBottomNav";
import CrmLogo from "@/app/components/admin/crm/CrmLogo";
import CrmMenu from "@/app/components/admin/crm/CrmMenu";
import CrmMobileDrawer from "@/app/components/admin/crm/CrmMobileDrawer";
import CrmNavBar from "@/app/components/admin/crm/CrmNavBar";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";

const CrmShell = ({
  children,
  displayName,
  role,
  preview,
}: {
  children: React.ReactNode;
  displayName: string;
  role: StaffRole | "PREVIEW";
  preview: boolean;
}) => {
  const { focusMode } = useCrm();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isCompactNav, setIsCompactNav] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => {
      const compact = mq.matches;
      setIsCompactNav(compact);
      if (!compact) setDrawerOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const closeMenu = useCallback(() => setDrawerOpen(false), []);
  const openMenu = useCallback(() => setDrawerOpen(true), []);
  const toggleMenu = useCallback(() => setDrawerOpen((open) => !open), []);

  return (
    <div
      className={`crm-app flex h-[100dvh] min-h-0${focusMode ? " crm-focus-mode" : ""}`}
    >
      {!focusMode && (
        <aside
          className="crm-sidebar crm-sidebar-scroll crm-sidebar-brand crm-glass-panel crm-no-scrollbar hidden h-full shrink-0 flex-col overflow-y-auto border-r border-[var(--crm-border)] lg:flex lg:w-[var(--crm-sidebar-w-lg)] lg:p-3"
          aria-label="Barra lateral"
        >
          <CrmLogo />
          <CrmMenu />
        </aside>
      )}

      <div className="crm-main-column flex min-w-0 flex-1 flex-col overflow-hidden">
        {!focusMode && (
          <CrmNavBar
            displayName={displayName}
            role={role}
            preview={preview}
            menuOpen={drawerOpen}
            onOpenMenu={toggleMenu}
          />
        )}
        <main
          className={`crm-main-scroll flex min-h-0 flex-1 flex-col overflow-y-auto${
            focusMode || !isCompactNav ? "" : " crm-main-with-bottom-nav"
          }`}
        >
          {preview && !focusMode && (
            <div className="px-4 pt-3 md:px-5 lg:px-6">
              <AdminPreviewBanner />
            </div>
          )}
          {children}
        </main>
        {!focusMode && isCompactNav && <CrmBottomNav onOpenMenu={openMenu} />}
      </div>

      {!focusMode && isCompactNav && (
        <CrmMobileDrawer
          open={drawerOpen}
          onClose={closeMenu}
          preview={preview}
        />
      )}
    </div>
  );
};

export default CrmShell;
