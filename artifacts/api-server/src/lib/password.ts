import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Password hashing with Node's built-in scrypt — no external dependency.
// Stored format: "scrypt$<saltHex>$<hashHex>".
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = (stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  let expected: Buffer;
  try { expected = Buffer.from(hashHex, "hex"); } catch { return false; }
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
