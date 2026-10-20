import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "net";
import { mailerConfig, sendEmail } from "../mailer";

describe("mailerConfig — Gmail SMTP first, Resend only as the fallback", () => {
  it("uses SMTP when SMTP_USER + SMTP_PASS are set (defaults: smtp.gmail.com:465, secure)", () => {
    const c = mailerConfig({ SMTP_USER: "kpr.alerts@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop", RESEND_API_KEY: "re_x" });
    expect(c.via).toBe("smtp");
    expect(c.smtp).toEqual({ host: "smtp.gmail.com", port: 465, secure: true, user: "kpr.alerts@gmail.com", pass: "abcdefghijklmnop" });
    expect(c.from()).toBe("KPR OM Database <kpr.alerts@gmail.com>");
    expect(c.from("KPR Feedback")).toBe("KPR Feedback <kpr.alerts@gmail.com>");
  });
  it("honours SMTP_FROM / SMTP_HOST / SMTP_PORT (587 = STARTTLS, not implicit TLS)", () => {
    const c = mailerConfig({ SMTP_USER: "u@x.com", SMTP_PASS: "p", SMTP_HOST: "smtp.office365.com", SMTP_PORT: "587", SMTP_FROM: "KPR <u@x.com>" });
    expect(c.smtp).toMatchObject({ host: "smtp.office365.com", port: 587, secure: false });
    expect(c.from("ignored")).toBe("KPR <u@x.com>");
  });
  it("needs BOTH SMTP_USER and SMTP_PASS — one alone falls back to Resend", () => {
    expect(mailerConfig({ SMTP_USER: "u@x.com", RESEND_API_KEY: "re_x" }).via).toBe("resend");
    expect(mailerConfig({ SMTP_PASS: "p", RESEND_API_KEY: "re_x", RESEND_FROM: "A <a@b.com>" }).from()).toBe("A <a@b.com>");
    expect(mailerConfig({ RESEND_API_KEY: "re_x" }).from()).toBe("KPR OM Database <onboarding@resend.dev>");
  });
  it("nothing configured → none", () => {
    expect(mailerConfig({}).via).toBe("none");
  });
});

describe("sendEmail never throws and reports the exact failure", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("not configured → ok:false with the fix named", async () => {
    for (const k of ["SMTP_USER", "SMTP_PASS", "RESEND_API_KEY"]) delete process.env[k];
    const r = await sendEmail({ to: "a@b.com", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: false, via: "none" });
    expect(r.detail).toMatch(/SMTP_USER/);
  });
  it("SMTP server refuses → ok:false with the error text, quickly", async () => {
    const srv = createServer((sock) => sock.destroy());
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", () => res()));
    const port = (srv.address() as { port: number }).port;
    Object.assign(process.env, { SMTP_USER: "u@x.com", SMTP_PASS: "p", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_SECURE: "false" });
    const r = await sendEmail({ to: "a@b.com", subject: "s", text: "t" });
    srv.close();
    expect(r.ok).toBe(false);
    expect(r.via).toBe("smtp");
    expect(r.detail).toBeTruthy();
  }, 30_000);

  it("a real SMTP conversation → ok:true, From = display name <SMTP_USER>, attachment carried", async () => {
    const lines: string[] = [];
    const srv = createServer((s) => {
      s.write("220 fake ESMTP\r\n"); let data = false, buf = "";
      s.on("data", (c) => { buf += c; let i: number; while ((i = buf.indexOf("\r\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (l === ".") { data = false; s.write("250 OK queued as TEST123\r\n"); } else lines.push(l); continue; }
        const u = l.toUpperCase();
        if (u.startsWith("EHLO")) s.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (u.startsWith("AUTH")) s.write("235 ok\r\n");
        else if (u.startsWith("DATA")) { data = true; s.write("354 go\r\n"); }
        else if (u.startsWith("QUIT")) { s.write("221 bye\r\n"); s.end(); }
        else s.write("250 ok\r\n"); } });
    });
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", () => res()));
    const port = (srv.address() as { port: number }).port;
    Object.assign(process.env, { SMTP_USER: "kpr.alerts@gmail.com", SMTP_PASS: "abcd efgh", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_SECURE: "false" });
    delete process.env.SMTP_FROM;
    const r = await sendEmail({ to: "efink@kprcenters.com", subject: "Hello", text: "hi", attachments: [{ filename: "shot.png", content: "aGk=" }], fromName: "KPR Feedback" });
    srv.close();
    expect(r).toMatchObject({ ok: true, via: "smtp", from: "KPR Feedback <kpr.alerts@gmail.com>" });
    expect(r.detail).toMatch(/TEST123/);
    expect(lines.join("\n")).toMatch(/^From: KPR Feedback <kpr\.alerts@gmail\.com>$/m);
    expect(lines.join("\n")).toMatch(/shot\.png/);
  }, 30_000);
});
