"use client";

import { signIn } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import {
  getLocalPhonePlaceholder,
  sanitizeLocalPhoneInput,
  validateLocalPhone,
} from "@/lib/phone";
import CheckoutCountrySelect from "../payments/CheckoutCountrySelect";
import GoogleAuthButton from "./GoogleAuthButton";
import {
  clearDraft,
  loadDraft,
  mergeDraft,
} from "../payments/onboardingDraft";

/*
 * Los campos van sobre la tarjeta **blanca** de `MemberAuthShell`, no sobre el
 * fondo de la app. Con `bg-card` (que es blanco) desaparecían: blanco sobre
 * blanco con un borde de 8% de opacidad no se lee como un campo, y el
 * formulario entero parecía vacío. `bg-muted` es el beige claro de la paleta y
 * `border-input` es el borde pensado para formularios — más marcado que
 * `border-border`, que es para separadores.
 */
const inputClass =
  "w-full rounded-xl border border-input bg-muted/60 px-4 py-3.5 font-[font1] text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-terracotta focus:bg-background focus:outline-none";

/* `text-muted-foreground` a 10px, en mayúsculas y con 0.22em de tracking se
 * lee gris apagado. Las etiquetas son la estructura del formulario, así que
 * van con el color del texto rebajado, no con el color de lo secundario. */
const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.22em] text-foreground/65";

const PASSWORD_MIN_LENGTH = 12;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = {
  email?: string;
  firstName?: string;
  phone?: string;
  password?: string;
  passwordConfirm?: string;
  consent?: string;
};

type OnboardingWizardProps = {
  /** Same-site path to land on (or continue to) once the account exists. */
  callbackUrl?: string;
  /** Inline embeds (checkout overlay): called after signup + sign-in instead
   *  of navigating away. */
  onComplete?: () => void;
  /** The email already has a working account — flip the host UI to login
   *  (also used when the email is a Google-only account). */
  onSwitchToLogin?: (email: string) => void;
  /**
   * Id del plan que se está comprando. Con él se guarda el borrador para que
   * refrescar, cambiar de pestaña o volver de Google no borre lo tecleado.
   */
  draftPlanId?: string;
  /** Pinta «Continuar con Google» encima del formulario. */
  googleEnabled?: boolean;
};

/**
 * Alta de cuenta en **una sola pantalla**.
 *
 * Fueron cuatro pasos —correo, nombre, WhatsApp, contraseña— y el problema no
 * era el número de campos sino dónde aparecían: este formulario se superpone
 * **en mitad del pago** de un taller o de la membresía, así que alguien que ya
 * decidió comprar se encontraba un asistente de cuatro pantallas entre él y el
 * botón de pagar. Ocho campos que se ven de golpe se leen como «esto es corto»;
 * cuatro pantallas que no dejan ver el final se leen como «esto es largo»,
 * aunque pidan exactamente lo mismo.
 *
 * Google va arriba del todo y no al final: quien lo use se salta los ocho
 * campos, y hasta ahora ninguno de los cuatro pasos lo ofrecía — el único
 * botón de Google vivía en el formulario de acceso, que es justo donde no
 * llega quien viene a registrarse.
 */
const OnboardingWizard = ({
  callbackUrl,
  onComplete,
  onSwitchToLogin,
  draftPlanId,
  googleEnabled = false,
}: OnboardingWizardProps) => {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("CO");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restored, setRestored] = useState(false);
  /** Último correo ya comprobado, para no repetir la llamada en cada blur. */
  const checkedEmailRef = useRef<string | null>(null);

  /**
   * Se rescata en un efecto y no durante el render: `sessionStorage` no existe
   * en el servidor y leerlo al pintar rompería la hidratación.
   */
  useEffect(() => {
    if (!draftPlanId) {
      setRestored(true);
      return;
    }
    const draft = loadDraft(draftPlanId);
    if (draft) {
      if (draft.email) setEmail(draft.email);
      if (draft.firstName) setFirstName(draft.firstName);
      if (draft.lastName) setLastName(draft.lastName);
      if (draft.phone) setPhone(draft.phone);
      if (draft.phoneCountry) setPhoneCountry(draft.phoneCountry);
      if (draft.consent) setConsent(draft.consent);
      // La contraseña nunca se guarda, y `step` ya no existe: el formulario es
      // uno solo. El borrador sigue haciendo falta porque el botón de Google
      // sí abandona la página.
    }
    setRestored(true);
  }, [draftPlanId]);

  /** Se guarda en cada cambio, ya restaurado, para no pisar el borrador. */
  useEffect(() => {
    if (!draftPlanId || !restored) return;
    mergeDraft(draftPlanId, {
      email,
      firstName,
      lastName,
      phone,
      phoneCountry,
      consent,
    });
  }, [
    draftPlanId,
    restored,
    email,
    firstName,
    lastName,
    phone,
    phoneCountry,
    consent,
  ]);

  const destination = callbackUrl ?? "/miembros";

  const clearError = (key: keyof FieldErrors) =>
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  /**
   * Comprobación de cuenta existente **al salir del campo**, no al enviar.
   *
   * Antes esto corría al pulsar «Continuar» del primer paso. Da igual el
   * momento para el servidor, pero no para la persona: enterarse de que ya
   * tienes cuenta después de teclear nombre, teléfono y contraseña dos veces
   * es tres pantallas de trabajo tirado.
   */
  const checkEmail = async () => {
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value) || checkedEmailRef.current === value) return;
    checkedEmailRef.current = value;

    try {
      const res = await fetch("/api/miembros/auth/email-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { status?: string };
      if (data.status !== "login" && data.status !== "google") return;

      if (onSwitchToLogin) {
        onSwitchToLogin(value);
        return;
      }
      setErrors((e) => ({
        ...e,
        email:
          data.status === "google"
            ? "Esta cuenta entra con Google. Inicia sesión en /acceso."
            : "Este correo ya tiene cuenta. Entra desde /acceso.",
      }));
    } catch {
      // Sin señal del servidor seguimos igual: el alta final valida.
    }
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = "Escribe un correo válido.";
    if (!firstName.trim()) next.firstName = "¿Cómo te llamas?";

    const { normalized, hint } = validateLocalPhone(
      phone,
      phoneCountry as CountryCode,
    );
    if (!phone.trim()) next.phone = "Déjanos tu WhatsApp.";
    else if (!normalized) next.phone = hint ?? "Revisa tu número.";

    if (password.trim().length < PASSWORD_MIN_LENGTH) {
      next.password = `Usa al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
    }
    if (password !== passwordConfirm) {
      next.passwordConfirm = "Las contraseñas no coinciden.";
    }
    if (!consent) next.consent = "Necesitamos tu autorización.";
    return next;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setFormError(null);

    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/miembros/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          phone,
          phoneCountry,
          password,
          consentData: true,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };

      if (!res.ok) {
        setLoading(false);
        // Cada error del servidor apunta a su campo: con todo a la vista, el
        // mensaje puede señalar exactamente dónde está el problema en vez de
        // devolver a un paso.
        if (data.error === "email_taken") {
          if (onSwitchToLogin) {
            onSwitchToLogin(email.trim().toLowerCase());
            return;
          }
          setErrors({ email: "Este correo ya tiene cuenta. Entra desde /acceso." });
          return;
        }
        if (data.error === "phone_taken") {
          setErrors({ phone: "Ese número ya está registrado con otra cuenta." });
          return;
        }
        if (data.error === "weak_password") {
          setErrors({ password: data.message ?? "Elige una contraseña más segura." });
          return;
        }
        if (data.error === "invalid_phone") {
          setErrors({ phone: "Revisa tu número de WhatsApp." });
          return;
        }
        setFormError("No pudimos crear tu cuenta. Intenta de nuevo.");
        return;
      }

      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      setLoading(false);

      // La cuenta ya existe: el borrador dejó de tener sentido y se tira, para
      // no dejar nombre y teléfono en el navegador más tiempo del necesario.
      if (draftPlanId) clearDraft(draftPlanId);

      if (result?.error) {
        // Cuenta creada pero el login automático falló: mándala al acceso.
        window.location.href = `/acceso?callbackUrl=${encodeURIComponent(destination)}`;
        return;
      }

      if (onComplete) onComplete();
      else window.location.href = destination;
    } catch {
      setLoading(false);
      setFormError("Error de red. Intenta de nuevo.");
    }
  };

  const fieldError = (key: keyof FieldErrors) =>
    errors[key] ? (
      <p role="alert" className="mt-1.5 font-[font1] text-xs text-terracotta">
        {errors[key]}
      </p>
    ) : null;

  return (
    <div className="space-y-6">
      {googleEnabled && (
        <>
          <GoogleAuthButton
            callbackUrl={destination}
            label="Continuar con Google"
          />
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-input" />
            <span className="font-[font2] text-[10px] uppercase tracking-[0.22em] text-foreground/45">
              o con tu correo
            </span>
            <span className="h-px flex-1 bg-input" />
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label className={labelClass} htmlFor="ob-email">
            Correo
          </label>
          <input
            id="ob-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError("email");
            }}
            onBlur={() => void checkEmail()}
            placeholder="tu@correo.com"
            aria-invalid={Boolean(errors.email)}
            className={inputClass}
          />
          {fieldError("email")}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ob-first">
              Nombre
            </label>
            <input
              id="ob-first"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                clearError("firstName");
              }}
              placeholder="Tu nombre"
              aria-invalid={Boolean(errors.firstName)}
              className={inputClass}
            />
            {fieldError("firstName")}
          </div>
          <div>
            <label className={labelClass} htmlFor="ob-last">
              Apellido <span className="text-foreground/40">(opcional)</span>
            </label>
            <input
              id="ob-last"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Tu apellido"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <CheckoutCountrySelect
            themed
            label="País del número"
            value={phoneCountry}
            onChange={(iso) => {
              setPhoneCountry(iso.toUpperCase());
              clearError("phone");
            }}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="ob-phone">
            WhatsApp
          </label>
          <input
            id="ob-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => {
              setPhone(
                sanitizeLocalPhoneInput(
                  e.target.value,
                  phoneCountry as CountryCode,
                ),
              );
              clearError("phone");
            }}
            placeholder={getLocalPhonePlaceholder(phoneCountry as CountryCode)}
            aria-invalid={Boolean(errors.phone)}
            className={inputClass}
          />
          {fieldError("phone")}
          <p className="mt-1.5 font-[font1] text-xs text-foreground/55">
            Vincula tus pagos y te llega la confirmación de cada compra.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ob-pass">
              Contraseña
            </label>
            <input
              id="ob-pass"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError("password");
              }}
              placeholder={`${PASSWORD_MIN_LENGTH}+ caracteres`}
              aria-invalid={Boolean(errors.password)}
              className={inputClass}
            />
            {fieldError("password")}
          </div>
          <div>
            <label className={labelClass} htmlFor="ob-pass2">
              Repetir contraseña
            </label>
            <input
              id="ob-pass2"
              type="password"
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(e) => {
                setPasswordConfirm(e.target.value);
                clearError("passwordConfirm");
              }}
              placeholder="La misma"
              aria-invalid={Boolean(errors.passwordConfirm)}
              className={inputClass}
            />
            {fieldError("passwordConfirm")}
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              clearError("consent");
            }}
            className="mt-1 h-4 w-4 shrink-0 accent-terracotta"
          />
          <span className="font-[font1] text-sm leading-snug text-foreground/70">
            Acepto el tratamiento de mis datos según el{" "}
            <a href="/aviso-privacidad" className="underline">
              aviso de privacidad
            </a>
            .
          </span>
        </label>
        {fieldError("consent")}

        {formError && (
          <p role="alert" className="font-[font1] text-sm text-terracotta">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-foreground px-8 py-4 font-[font2] text-sm uppercase tracking-[0.18em] text-background transition-opacity disabled:opacity-50"
        >
          {loading ? "Creando tu cuenta…" : "Crear mi cuenta"}
        </button>
      </form>
    </div>
  );
};

export default OnboardingWizard;
