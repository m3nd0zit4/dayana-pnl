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
  CONSENT_DENIED,
  CONSENT_GRANTED,
  readConsent,
  writeConsent,
  type ConsentCategories,
} from "../../lib/cookies/consent";

type ConsentStatus = "hydrating" | "unset" | "set";

type CookieConsentContextValue = {
  status: ConsentStatus;
  /** Elección del visitante. Todo en false mientras no haya decidido. */
  consent: ConsentCategories;
  /** El despliegue permite cargar analítica (producción/preview en Vercel). */
  analyticsAllowed: boolean;
  /** Listos para medir uso del sitio: decisión tomada + aceptada + desplegado. */
  analyticsEnabled: boolean;
  /** Listos para píxeles publicitarios (Meta, Google Ads). */
  marketingEnabled: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  savePreferences: (value: ConsentCategories) => void;
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
  const [consent, setConsent] = useState<ConsentCategories>(CONSENT_DENIED);

  useEffect(() => {
    const stored = readConsent();
    if (stored) {
      setConsent(stored);
      setStatus("set");
    } else {
      setStatus("unset");
    }
  }, []);

  const commit = useCallback((value: ConsentCategories) => {
    writeConsent(value);
    setConsent(value);
    setStatus("set");
  }, []);

  const acceptAll = useCallback(() => commit(CONSENT_GRANTED), [commit]);
  const rejectAll = useCallback(() => commit(CONSENT_DENIED), [commit]);

  const value = useMemo<CookieConsentContextValue>(() => {
    const decided = status === "set";
    return {
      status,
      consent,
      analyticsAllowed,
      analyticsEnabled: decided && consent.analytics && analyticsAllowed,
      marketingEnabled: decided && consent.marketing && analyticsAllowed,
      acceptAll,
      rejectAll,
      savePreferences: commit,
    };
  }, [status, consent, analyticsAllowed, acceptAll, rejectAll, commit]);

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
