"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@/app/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/app/components/ui/drawer";

type Props = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  large?: boolean;
};

/**
 * Bottom sheet on mobile (matches the old .crm-modal behavior: anchored to
 * the viewport bottom, rounded top only), centered dialog on desktop —
 * same prop surface as before so every consumer (9+ modals) needs zero
 * call-site changes.
 */
const CrmModal = ({ title, open, onClose, children, large }: Props) => {
  const isMobile = useIsMobile();

  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className={large ? "[--drawer-height:92dvh]" : undefined}>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[92vh] overflow-y-auto sm:max-w-lg",
          large && "sm:max-w-2xl"
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
};

export default CrmModal;
