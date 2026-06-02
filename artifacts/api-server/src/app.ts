import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Express 5 defaults the query parser to "simple", which leaves bracketed
// array params under the literal key "dealId[]" instead of "dealId". The
// analytics routes (and their dealId[]= filters used by the All/Owned scope
// toggle) rely on the Express 4 "extended" (qs) behavior, so restore it.
app.set("query parser", "extended");

// Behind Replit's HTTPS proxy — needed so `cookie.secure: "auto"` correctly
// detects HTTPS and marks session cookies Secure in production.
app.set("trust proxy", 1);


app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const ABSOLUTE_SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000; // hard re-login cap: 30 days

// In-memory session store (default). NOTE: kept in-memory deliberately — a
// Postgres-backed store (connect-pg-simple) was attempted but crashed the
// deployment on start, so sessions live in memory (users re-login after a
// deploy/restart; accounts & approvals are always persisted in the DB).
app.use(session({
  secret: process.env.SESSION_SECRET || "kpr-om-database-secret",
  resave: false,
  saveUninitialized: false,
  rolling: true, // extend the idle window on each response while active
  cookie: {
    httpOnly: true,
    // Default off so the session cookie is always stored (login reliably works);
    // set SECURE_COOKIES=true in the deployment once HTTPS is confirmed to harden.
    secure: process.env.SECURE_COOKIES === "true",
    maxAge: 14 * 24 * 60 * 60 * 1000, // idle timeout: 14 days of inactivity
    sameSite: "lax",
  },
}));

// Absolute session cap — force re-login 30 days after sign-in regardless of
// activity (rolling sessions otherwise never expire for active users).
app.use((req, res, next) => {
  const s = req.session;
  if (s && s.authenticated && s.loginAt && Date.now() - s.loginAt > ABSOLUTE_SESSION_MAX_MS) {
    s.destroy(() => res.status(401).json({ error: "Session expired — please sign in again." }));
    return;
  }
  next();
});

app.use("/api", router);

export default app;
