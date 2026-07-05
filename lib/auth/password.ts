import { hash, compare } from "bcryptjs";

const ROUNDS = 12;

export const hashStaffPassword = async (password: string): Promise<string> =>
  hash(password, ROUNDS);

export const verifyStaffPassword = async (
  password: string,
  passwordHash: string
): Promise<boolean> => compare(password, passwordHash);

// Neutral aliases — member auth shares the same hashing scheme.
export const hashPassword = hashStaffPassword;
export const verifyPassword = verifyStaffPassword;
