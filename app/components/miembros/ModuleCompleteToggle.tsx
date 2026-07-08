"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/app/components/ui/button";

const ModuleCompleteToggle = ({
  moduleId,
  initialCompleted,
}: {
  moduleId: string;
  initialCompleted: boolean;
}) => {
  const [completed, setCompleted] = useState(initialCompleted);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    const next = !completed;
    const res = await fetch(`/api/miembros/modules/${moduleId}/progress`, {
      method: next ? "POST" : "DELETE",
    });
    setLoading(false);
    if (res.ok) setCompleted(next);
  };

  return (
    <Button
      variant={completed ? "default" : "outline"}
      size="sm"
      disabled={loading}
      onClick={() => void toggle()}
    >
      <Check />
      {completed ? "Completado" : "Marcar como completado"}
    </Button>
  );
};

export default ModuleCompleteToggle;
