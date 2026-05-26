import { Router } from "express";

const router = Router();

const APP_PASSWORD = process.env.APP_PASSWORD;

// POST /api/auth/login
router.post("/auth/login", (req, res) => {
  const { password } = req.body as { password?: string };

  if (!APP_PASSWORD) {
    res.status(500).json({ error: "APP_PASSWORD not configured" });
    return;
  }

  if (!password || password !== APP_PASSWORD) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  req.session.authenticated = true;
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get("/auth/me", (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

export default router;
