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
    };

    if (!body.message?.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
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
          "",
          row.message,
        ].join("\n");

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
