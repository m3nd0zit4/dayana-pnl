"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * A tab that stays open across a release keeps running the old JavaScript
 * (no sync, old bugs) until it is reloaded. The first answer of
 * `/api/admin/version` is this tab's build; when the tab comes back to the
 * front (or every 10 minutes while visible) and the server reports another
 * one, a sticky notice offers to reload. Never reloads by itself: something
 * may be half typed.
 */
const VERSION_URL = "/api/admin/version";
const CHECK_EVERY_MS = 10 * 60_000;
const MIN_GAP_MS = 60_000;

const fetchVersion = async (): Promise<string | null> => {
  try {
    const res = await fetch(VERSION_URL, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    const { version } = (await res.json()) as { version?: unknown };
    return typeof version === "string" && version ? version : null;
  } catch {
    return null;
  }
};

const NewVersionNotice = () => {
  const mine = useRef<string | null>(null);
  const lastCheck = useRef(0);
  const shown = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const check = async (force = false) => {
      if (shown.current || cancelled) return;
      const now = Date.now();
      if (!force && now - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = now;
      const version = await fetchVersion();
      if (!version || cancelled) return;
      if (mine.current === null) {
        mine.current = version;
        return;
      }
      if (version !== mine.current) {
        shown.current = true;
        toast("Hay una versión nueva del CRM", {
          description: "Recarga para usar lo último (y ver lo que hiciste en otros dispositivos).",
          duration: Infinity,
          action: { label: "Recargar", onClick: () => window.location.reload() },
        });
      }
    };
    void check(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, CHECK_EVERY_MS);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
};

export default NewVersionNotice;
