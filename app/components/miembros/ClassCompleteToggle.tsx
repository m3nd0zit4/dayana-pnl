"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/app/components/ui/button";

/**
 * Botón de completar, **controlado**.
 *
 * Antes guardaba su propio estado a partir de la prop inicial, así que cuando
 * la lección se marcaba desde fuera —el auto-completado por tiempo, el quiz
 * aprobado, el ejercicio terminado— el botón seguía diciendo «Marcar como
 * completada». Ahora el estado vive en el reproductor y este componente solo lo
 * pinta.
 */
const ClassCompleteToggle = ({
  classId,
  completed,
  onChange,
  size = "sm",
  className,
}: {
  classId: string;
  completed: boolean;
  onChange: (completed: boolean) => void;
  size?: "sm" | "default" | "lg";
  className?: string;
}) => {
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    const next = !completed;
    // Optimista: marcar una lección tiene que sentirse instantáneo. Si la
    // petición falla se revierte.
    onChange(next);
    const res = await fetch(`/api/miembros/classes/${classId}/progress`, {
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
      className={className}
      onClick={() => void toggle()}
    >
      <Check />
      {completed ? "Completada" : "Marcar como completada"}
    </Button>
  );
};

export default ClassCompleteToggle;
