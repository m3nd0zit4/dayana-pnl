"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  readAnalyticsConsent,
  writeAnalyticsConsent,
  type AnalyticsConsentValue,
} from "../../lib/cookies/consent";

type ConsentStatus = "hydrating" | "unset" | AnalyticsConsentValue;

type CookieConsentContextValue = {
  status: ConsentStatus;
  analyticsAllowed: boolean;
  acceptAnalytics: () => void;
  rejectAnalytics: () => void;
};

const CookieConsentContext = createContext<CookieConsentContextValue | null>(
  null
);

export const CookieConsentProvider = ({
  children,
  analyticsAllowed,
}: {
  children: ReactNode;
  analyticsAllowed: boolean;
}) => {
  const [status, setStatus] = useState<ConsentStatus>("hydrating");

  useEffect(() => {
    const stored = readAnalyticsConsent();
    setStatus(stored ?? "unset");
  }, []);

  const acceptAnalytics = useCallback(() => {
    writeAnalyticsConsent("accepted");
    setStatus("accepted");
  }, []);

  const rejectAnalytics = useCallback(() => {
    writeAnalyticsConsent("rejected");
    setStatus("rejected");
  }, []);

  const value = useMemo(
    () => ({
      status,
      analyticsAllowed,
      acceptAnalytics,
      rejectAnalytics,
    }),
    [status, analyticsAllowed, acceptAnalytics, rejectAnalytics]
  );

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
    </CookieConsentContext.Provider>
  );
};

export const useCookieConsent = (): CookieConsentContextValue => {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) {
    throw new Error(
      "useCookieConsent must be used within CookieConsentProvider"
    );
  }
  return ctx;
};
