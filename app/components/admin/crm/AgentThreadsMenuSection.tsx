"use client";

import { ChevronRight, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/app/components/ui/sidebar";
import { useCrm } from "./CrmProvider";
import { listThreads, type AgentThread } from "./agent-panel/thread-store";

/**
 * `crmMenuSections` (app/config/crm-menu-items.ts) is static, `Link`-driven
 * config — not a fit for these dynamic, localStorage-backed, click-handler
 * items, so this lives as its own component rather than folding into
 * `CrmMenu`. Mirrors `CrmMenuParentItem`'s collapsible/chevron pattern.
 */
const AgentThreadsMenuSection = () => {
  const { openAgentThread } = useCrm();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<AgentThread[]>([]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setThreads(listThreads());
  };

  return (
    <SidebarGroup>
      <Collapsible open={open} onOpenChange={handleOpenChange}>
        <SidebarGroupLabel
          render={
            <CollapsibleTrigger className="flex w-full items-center" />
          }
        >
          Conversaciones del agente
          <ChevronRight className={`ml-auto transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarMenu>
            {threads.length === 0 ? (
              <SidebarMenuItem>
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Sin conversaciones aún</p>
              </SidebarMenuItem>
            ) : (
              <SidebarMenuSub className="mr-0 ml-0 border-l-0 px-0">
                {threads.map((thread) => (
                  <SidebarMenuSubItem key={thread.id}>
                    <SidebarMenuSubButton
                      render={<button type="button" />}
                      onClick={() => openAgentThread(thread.id)}
                      className="hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground"
                    >
                      <MessageSquareText />
                      <span className="truncate">{thread.title}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            )}
          </SidebarMenu>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
};

export default AgentThreadsMenuSection;
