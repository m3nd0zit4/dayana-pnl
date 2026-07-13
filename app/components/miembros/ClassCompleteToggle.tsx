"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/app/components/ui/button";

const ClassCompleteToggle = ({
  classId,
  initialCompleted,
  onChange,
}: {
  classId: string;
  initialCompleted: boolean;
  onChange?: (completed: boolean) => void;
}) => {
  const [completed, setCompleted] = useState(initialCompleted);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    const next = !completed;
    const res = await fetch(`/api/miembros/classes/${classId}/progress`, {
      method: next ? "POST" : "DELETE",
    });
    setLoading(false);
    if (res.ok) {
      setCompleted(next);
      onChange?.(next);
    }
  };

  return (
    <Button
      variant={completed ? "default" : "outline"}
      size="sm"
      disabled={loading}
      onClick={() => void toggle()}
    >
      <Check />
      {completed ? "Completada" : "Marcar como completada"}
    </Button>
  );
};

export default ClassCompleteToggle;
