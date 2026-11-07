"use client";

import { useEffect, type ReactNode } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/app/components/ui/drawer";
import { useSidebar } from "@/app/components/ui/sidebar";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The same `AgentPanelHeader` the desktop aside uses (picker, history, new). */
  header: ReactNode;
  /** The same `AgentPanelSession`: every feature of the desktop panel. */
  children: ReactNode;
};

/**
 * Full-screen bottom sheet — the mobile counterpart to `AgentPanel`'s desktop
 * `<aside>`. Binary open/closed (no snap points): a phone-width sheet opened
 * to full height already IS the "expanded" state, so there's no expand
 * toggle here.
 */
const AgentPanelMobile = ({ open, onOpenChange, header, children }: Props) => {
  const { setOpenMobile } = useSidebar();

  // The nav Sidebar's own Sheet knows nothing of this one — without this both
  // can end up stacked (blurred nav behind the chat, no way back).
  useEffect(() => {
    if (open) setOpenMobile(false);
  }, [open, setOpenMobile]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent
        className="[--drawer-height:100svh] bg-popover text-popover-foreground"
        data-testid="agent-panel"
        data-mobile="true"
      >
        <DrawerHeader className="flex-row items-center gap-1 border-b border-border p-2 pb-2">
          <DrawerTitle className="sr-only">Asistente del CRM</DrawerTitle>
          {header}
        </DrawerHeader>
        {open && children}
      </DrawerContent>
    </Drawer>
  );
};

export default AgentPanelMobile;
