import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// RFC 6238 TOTP (the algorithm every authenticator app — Google Authenticator,
// Authy, 1Password — speaks): SHA-1, 6 digits, 30-second period. Implemented on
// Node's crypto so there is no third-party runtime dependency in the auth path.

const PERIOD = 30;
const DIGITS = 6;
const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648 base32

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPH[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/,"").replace(/\s+/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPH.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// A fresh 20-byte (160-bit) base32 secret — the standard size for TOTP.
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

// The HOTP/TOTP code for a given counter (time-step).
function hotp(secretBuf: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (high word stays 0 well past year 9999).
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export function totp(secret: string, atMs: number = Date.now()): string {
  return hotp(base32Decode(secret), Math.floor(atMs / 1000 / PERIOD));
}

// Verify a user-entered token, allowing ±`window` steps for clock drift.
export function verifyTotp(secret: string, token: string, window = 1, atMs: number = Date.now()): boolean {
  const t = (token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  const buf = base32Decode(secret);
  const counter = Math.floor(atMs / 1000 / PERIOD);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(buf, counter + i);
    // constant-time compare (both 6 ASCII digits)
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(t))) return true;
  }
  return false;
}

// otpauth:// URI an authenticator app reads (label = "Issuer:account").
export function otpauthUri(secret: string, account: string, issuer = "KPR OM Database"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(PERIOD) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
