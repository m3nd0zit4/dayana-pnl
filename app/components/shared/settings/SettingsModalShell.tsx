"use client";

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import SettingsNav, { type SettingsNavItem } from "./SettingsNav";

type SettingsModalShellProps = {
  navItems: SettingsNavItem[];
  children: React.ReactNode;
};

/**
 * Renders the settings tabs as a card overlay (intercepted route via the
 * `@modal` parallel slot) instead of a full page navigation. Presence in the
 * tree means the modal is the active route — closing it means going back to
 * whatever page was open before, not to a fixed URL.
 *
 * Fixed overall card size (title + nav never scroll) — only the tab content
 * pane on the right scrolls, so wide tables/long forms don't clip the card.
 */
const SettingsModalShell = ({ navItems, children }: SettingsModalShellProps) => {
  const router = useRouter();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <DialogContent className="flex h-[min(85vh,44rem)] w-full max-w-3xl flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogTitle className="shrink-0 border-b px-5 py-4">
          Mi cuenta
        </DialogTitle>
        <div className="flex min-h-0 flex-1">
          <div className="w-40 shrink-0 overflow-y-auto border-r p-3 sm:w-48">
            <SettingsNav items={navItems} />
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsModalShell;
