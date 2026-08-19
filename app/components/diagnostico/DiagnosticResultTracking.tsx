"use client";

import { useEffect, useRef } from "react";

import { pushDataLayerEvent } from "@/lib/analytics/dataLayer";

/**
 * Dispara `view_diagnostic_result` una vez por montaje.
 *
 * Va en su propio componente cliente para que la página de resultado siga
 * siendo un server component: es la que hace las consultas y la que debe poder
 * renderizarse sin JavaScript.
 */
const DiagnosticResultTracking = ({ profile }: { profile: string }) => {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    pushDataLayerEvent("view_diagnostic_result", { profile });
  }, [profile]);

  return null;
};

export default DiagnosticResultTracking;
