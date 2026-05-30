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

app.use(session({
  secret: process.env.SESSION_SECRET || "kpr-om-database-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax",
  },
}));

app.use("/api", router);

export default app;
