"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/app/components/ui/button";

/**
 * Botón de completar la introducción del módulo, **controlado**.
 *
 * Igual que su hermano de clases: guardaba su propio estado a partir de la prop
 * inicial, así que cuando la introducción se marcaba desde fuera —el
 * auto-completado por permanencia— el botón seguía diciendo «Marcar como
 * completado». El estado vive en el reproductor; aquí solo se pinta.
 */
const ModuleCompleteToggle = ({
  moduleId,
  completed,
  onChange,
  size = "sm",
}: {
  moduleId: string;
  completed: boolean;
  onChange: (completed: boolean) => void;
  size?: "sm" | "default" | "lg";
}) => {
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    const next = !completed;
    onChange(next);
    const res = await fetch(`/api/miembros/modules/${moduleId}/progress`, {
      method: next ? "POST" : "DELETE",
    });
    setLoading(false);
    if (!res.ok) onChange(!next);
  };

  return (
    <Button
      variant={completed ? "default" : "outline"}
      size={size}
      disabled={loading}
      onClick={() => void toggle()}
    >
      <Check />
      {completed ? "Completado" : "Marcar como completado"}
    </Button>
  );
};

export default ModuleCompleteToggle;
