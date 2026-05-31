import { Router } from "express";
import { db } from "@workspace/db";
import { feedbackTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

// POST /api/feedback
router.post("/feedback", requireAuth, async (req, res) => {
  try {
    const body = req.body as {
      type?: string;
      message?: string;
      name?: string;
      page?: string;
      userAgent?: string;
      images?: string[];   // data URLs from the widget (pasted/attached screenshots)
    };

    if (!body.message?.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    // Parse any attached images (data URLs) into Resend attachment objects. Cap the
    // count and total size defensively so a huge paste can't blow past email limits.
    const attachments: Array<{ filename: string; content: string }> = [];
    if (Array.isArray(body.images)) {
      let totalBytes = 0;
      for (let i = 0; i < body.images.length && attachments.length < 5; i++) {
        const img = body.images[i];
        if (typeof img !== "string") continue;
        const m = img.match(/^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!m) continue;
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        const b64 = m[2];
        totalBytes += Math.floor(b64.length * 0.75);
        if (totalBytes > 18 * 1024 * 1024) break;  // ~18MB ceiling, well under Resend's 40MB
        attachments.push({ filename: `screenshot-${i + 1}.${ext}`, content: b64 });
      }
    }

    const [row] = await db
      .insert(feedbackTable)
      .values({
        type: body.type?.trim() || "other",
        message: body.message.trim(),
        name: body.name?.trim() || null,
        page: body.page?.trim() || null,
        userAgent: body.userAgent?.trim() || null,
      })
      .returning();

    // Best-effort email — capture status, never block response
    let emailStatus: string;
    let emailError: string | null = null;

    try {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        emailStatus = "skipped";
      } else {
        const to = process.env.FEEDBACK_EMAIL_TO || "efink@kprcenters.com";
        const summary = [
          "New KPR feedback",
          `Type: ${row.type}`,
          `From: ${row.name || "anonymous"}`,
          `Page: ${row.page || "unknown"}`,
          `Time: ${row.createdAt.toISOString()}`,
          attachments.length ? `Screenshots: ${attachments.length} attached` : null,
          "",
          row.message,
        ].filter(Boolean).join("\n");

        const emailResp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "KPR Feedback <onboarding@resend.dev>",
            to,
            subject: `New KPR feedback: ${row.type}`,
            text: summary,
            ...(attachments.length ? { attachments } : {}),
          }),
        });

        const respBody = await emailResp.text().catch(() => "");
        req.log.info({ status: emailResp.status, body: respBody.slice(0, 200) }, "Resend response");

        if (emailResp.ok) {
          emailStatus = "sent";
        } else {
          emailStatus = "failed";
          emailError = `HTTP ${emailResp.status}: ${respBody}`.slice(0, 300);
        }
      }
    } catch (emailErr) {
      emailStatus = "failed";
      emailError = (emailErr instanceof Error ? emailErr.message : String(emailErr)).slice(0, 300);
      req.log.warn({ err: emailErr }, "Feedback email threw (non-fatal)");
    }

    await db
      .update(feedbackTable)
      .set({ emailStatus, emailError })
      .where(eq(feedbackTable.id, row.id));

    res.json({ id: row.id, createdAt: row.createdAt });
  } catch (err) {
    req.log.error({ err }, "Failed to save feedback");
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

// GET /api/feedback
router.get("/feedback", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(feedbackTable)
      .orderBy(desc(feedbackTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list feedback");
    res.status(500).json({ error: "Failed to list feedback" });
  }
});

// PATCH /api/feedback/:id
router.patch("/feedback/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const { resolved } = req.body as { resolved: boolean };
    await db
      .update(feedbackTable)
      .set({ resolved: Boolean(resolved) })
      .where(eq(feedbackTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update feedback");
    res.status(500).json({ error: "Failed to update feedback" });
  }
});

export default router;
