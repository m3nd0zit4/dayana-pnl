import { hash, compare } from "bcryptjs";

const ROUNDS = 12;

export const hashStaffPassword = async (password: string): Promise<string> =>
  hash(password, ROUNDS);

export const verifyStaffPassword = async (
  password: string,
  passwordHash: string
): Promise<boolean> => compare(password, passwordHash);
