import { randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto";

export const MIN_PASSWORD_LENGTH = 10;

// A small block-list of the most common/guessable passwords (NIST-style: favor
// length + a common-password screen over rigid complexity rules).
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "111111111", "letmein123", "welcome1",
  "welcome123", "admin123", "iloveyou1", "abc123456", "monkey123", "dragon123",
  "sunshine1", "princess1", "football1", "baseball1", "trustno1", "starwars1",
  "whatever1", "changeme1", "secret123", "master123", "shadow123", "superman1",
  "michael1", "computer1", "qazwsxedc", "1q2w3e4r5t", "zaq12wsx", "password!",
  "kprcenters", "kprcenters1", "realestate", "commercial",
]);

// Returns an error message if the password is unacceptable, else null.
export function validatePassword(password: string, email?: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password is too long.";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "That password is too common — please choose a stronger one.";
  if (email) {
    const e = email.trim().toLowerCase();
    const local = e.split("@")[0];
    if (lower === e || (local && local.length >= 3 && lower.includes(local))) {
      return "Password can't contain your email address.";
    }
  }
  return null;
}

// SHA-256 hex — used to store password-reset tokens (we email the raw token,
// keep only its hash).
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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
