"use client";

import { useEffect, useState } from "react";
import { ChevronDown, SquarePen, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Drawer, DrawerContent, DrawerHeader } from "@/app/components/ui/drawer";
import { useSidebar } from "@/app/components/ui/sidebar";
import { AgentPanelSession } from "./AgentPanel";
import type { AgentThread } from "./thread-store";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  threads: AgentThread[];
  onThreadsMenuOpen: () => void;
  threadId: string;
  seed: string | undefined;
  onTitleChange: (title: string) => void;
  onNewThread: () => void;
  onSwitchThread: (thread: AgentThread) => void;
};

/**
 * Full-screen bottom sheet — the mobile counterpart to `AgentPanel`'s desktop
 * `<aside>`. Binary open/closed (no snap points): a phone-width sheet opened
 * to (nearly) full height already IS the "expanded" state, so there's no
 * `ChevronsLeftRight` expand toggle here the way the desktop header has one.
 */
const AgentPanelMobile = ({
  open,
  onOpenChange,
  title,
  threads,
  onThreadsMenuOpen,
  threadId,
  seed,
  onTitleChange,
  onNewThread,
  onSwitchThread,
}: Props) => {
  const [threadsMenuOpen, setThreadsMenuOpen] = useState(false);
  const { setOpenMobile } = useSidebar();

  // The nav Sidebar's own Sheet (hamburger, or a thread tapped from its
  // "Conversaciones del agente" section) has no knowledge of this sheet —
  // without this, both can end up open/stacked at once (blurred nav behind
  // the chat sheet, no way back to other sections without closing both).
  useEffect(() => {
    if (open) setOpenMobile(false);
  }, [open, setOpenMobile]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="[--drawer-height:100svh] bg-popover text-popover-foreground">
        <DrawerHeader className="flex-row items-center gap-1 border-b border-border p-2 pb-2">
          <DropdownMenu
            open={threadsMenuOpen}
            onOpenChange={(next) => {
              setThreadsMenuOpen(next);
              if (next) onThreadsMenuOpen();
            }}
          >
            <DropdownMenuTrigger
              className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-accent"
              render={<button type="button" />}
            >
              <span className="min-w-0 truncate">{title}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {threads.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Sin conversaciones aún</p>
              )}
              {threads.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => onSwitchThread(t)}>
                  <span className="truncate">{t.title}</span>
                </DropdownMenuItem>
              ))}
              {threads.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={onNewThread}>Nueva conversación</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Nueva conversación" onClick={onNewThread}>
            <SquarePen className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Cerrar"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </DrawerHeader>

        {open && (
          <AgentPanelSession key={threadId} threadId={threadId} seedMessage={seed} onTitleChange={onTitleChange} />
        )}
      </DrawerContent>
    </Drawer>
  );
};

export default AgentPanelMobile;
