"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pushDataLayerEvent } from "../../../lib/analytics/dataLayer";
import { isPrivatePath } from "../../../lib/analytics/private-path";

/**
 * Next.js App Router client-side navigations don't reload the page, so GTM's
 * default pageview trigger never refires. Pushes a virtual_pageview event on
 * every route change instead; the initial load is already covered by GTM's
 * built-in Initialization trigger, so that first render is skipped.
 */
const GtmRouteTracking = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // La dirección de una página personal es un secreto: no va a la analítica.
    if (isPrivatePath(pathname)) return;
    const query = searchParams.toString();
    const path = query ? `${pathname}?${query}` : pathname;
    pushDataLayerEvent("virtual_pageview", {
      page_path: path,
      page_location: window.location.href,
    });
  }, [pathname, searchParams]);

  return null;
};

export default GtmRouteTracking;
