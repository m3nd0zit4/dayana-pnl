"use client";

import { Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { useCrm } from "../CrmProvider";
import BroadcastNotifyModal from "./BroadcastNotifyModal";

/** «Avisar por correo»: la campaña del taller abierto, junto a la invitación por WhatsApp. */
const WorkshopEmailNotifyButton = ({ editionId, title }: { editionId: string; title: string }) => {
  const { canWrite } = useCrm();
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Mail aria-hidden />
        Avisar por correo
      </Button>
      <BroadcastNotifyModal
        open={open}
        workshopEditionId={editionId}
        workshopTitle={title}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

export default WorkshopEmailNotifyButton;
