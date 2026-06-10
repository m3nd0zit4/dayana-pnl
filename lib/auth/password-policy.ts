const MIN_LENGTH = 12;

const COMMON_PASSWORDS = new Set(
  [
    "password1234",
    "123456789012",
    "qwertyuiop12",
    "adminadmin12",
    "dayanabeltran",
    "staffpassword",
  ].map((p) => p.toLowerCase())
);

export type PasswordValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export const validateStaffPassword = (
  password: string
): PasswordValidationResult => {
  const trimmed = password.trim();
  if (!trimmed) {
    return { ok: false, error: "La contraseña no puede estar vacía." };
  }
  if (trimmed.length < MIN_LENGTH) {
    return {
      ok: false,
      error: `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`,
    };
  }
  if (COMMON_PASSWORDS.has(trimmed.toLowerCase())) {
    return {
      ok: false,
      error: "Elige una contraseña menos común.",
    };
  }
  return { ok: true };
};

export const STAFF_PASSWORD_MIN_LENGTH = MIN_LENGTH;
