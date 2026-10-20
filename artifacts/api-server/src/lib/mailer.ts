// ONE shared outbound-email sender for the whole server (auth emails, feedback, anything new).
// Gmail SMTP when SMTP_USER + SMTP_PASS are set (Eric, 10/20/26 — Resend's shared
// onboarding@resend.dev sender only delivers to the Resend account owner, and verifying
// kprcenters.com in Resend needs IT DNS changes); Resend only as the fallback. Never throws;
// every outcome is logged so a delivery failure shows in the server logs.
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "./logger";

export type MailVia = "smtp" | "resend" | "none";
export interface MailAttachment { filename: string; /** base64 */ content: string }
export interface MailMessage { to: string; subject: string; text: string; attachments?: MailAttachment[]; /** display name when no SMTP_FROM/RESEND_FROM is set */ fromName?: string }
export interface MailResult { ok: boolean; via: MailVia; from: string | null; detail?: string }

type Env = Record<string, string | undefined>;
export interface MailerConfig {
  via: MailVia;
  smtp?: { host: string; port: number; secure: boolean; user: string; pass: string };
  resendKey?: string;
  from: (fromName?: string) => string | null;
}

/** Pure: which transport the environment selects, and the From line. */
export function mailerConfig(env: Env = process.env): MailerConfig {
  const user = env.SMTP_USER?.trim();
  // Gmail shows app passwords as "abcd efgh ijkl mnop" — the spaces aren't part of it.
  const pass = env.SMTP_PASS?.replace(/\s+/g, "");
  if (user && pass) {
    const port = Number(env.SMTP_PORT) || 465;
    const secureEnv = env.SMTP_SECURE?.trim().toLowerCase();
    const secure = secureEnv ? secureEnv === "true" || secureEnv === "1" : port === 465;
    return {
      via: "smtp",
      smtp: { host: env.SMTP_HOST?.trim() || "smtp.gmail.com", port, secure, user, pass },
      from: (fromName) => env.SMTP_FROM?.trim() || `${fromName || "KPR OM Database"} <${user}>`,
    };
  }
  const resendKey = env.RESEND_API_KEY?.trim();
  if (resendKey) {
    return {
      via: "resend", resendKey,
      from: (fromName) => env.RESEND_FROM?.trim() || `${fromName || "KPR OM Database"} <onboarding@resend.dev>`,
    };
  }
  return { via: "none", from: () => null };
}

let cached: { key: string; t: Transporter } | null = null;
function transporter(s: NonNullable<MailerConfig["smtp"]>): Transporter {
  const key = `${s.host}|${s.port}|${s.secure}|${s.user}|${s.pass}`;
  if (cached?.key !== key) {
    cached = {
      key,
      t: nodemailer.createTransport({
        host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass },
        // A request that awaits a send must never hang on a dead mail server.
        connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      }),
    };
  }
  return cached.t;
}

export async function sendEmail(msg: MailMessage): Promise<MailResult> {
  const cfg = mailerConfig();
  const from = cfg.from(msg.fromName);
  const ctx = { to: msg.to, subject: msg.subject, via: cfg.via, from };
  if (cfg.via === "none" || !from) {
    logger.error(ctx, "email NOT sent — no mail transport configured (set SMTP_USER + SMTP_PASS)");
    return { ok: false, via: "none", from: null, detail: "Email isn't configured on the server: set the SMTP_USER and SMTP_PASS secrets." };
  }
  try {
    if (cfg.via === "smtp") {
      const info = await transporter(cfg.smtp!).sendMail({
        from, to: msg.to, subject: msg.subject, text: msg.text,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, encoding: "base64" })),
      });
      const rejected = (info.rejected ?? []).map(String);
      if (rejected.length) {
        logger.error({ ...ctx, rejected, response: info.response }, "email send FAILED (SMTP server rejected the recipient)");
        return { ok: false, via: "smtp", from, detail: `Rejected by the mail server: ${rejected.join(", ")} — ${info.response ?? ""}`.trim() };
      }
      logger.info({ ...ctx, messageId: info.messageId }, "email sent");
      return { ok: true, via: "smtp", from, detail: info.response };
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text, ...(msg.attachments?.length ? { attachments: msg.attachments } : {}) }),
    });
    const body = await r.text().catch(() => "");
    if (!r.ok) {
      logger.error({ ...ctx, status: r.status, body: body.slice(0, 500) }, "email send FAILED (Resend rejected it)");
      return { ok: false, via: "resend", from, detail: `Resend HTTP ${r.status}: ${body.slice(0, 300)}` };
    }
    logger.info(ctx, "email sent");
    return { ok: true, via: "resend", from };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error({ ...ctx, err: detail }, "email send FAILED (threw)");
    return { ok: false, via: cfg.via, from, detail };
  }
}
