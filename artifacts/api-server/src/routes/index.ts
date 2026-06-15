import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import authRouter from "./auth";
import dealsRouter from "./deals";
import ingestRouter from "./ingest";
import aliasesRouter from "./aliases";
import tenantDecisionsRouter from "./tenantDecisions";
import tenantIndexRouter from "./tenantIndex";
import analyticsRouter from "./analytics";
import compsRouter from "./comps";
import watchlistRouter from "./watchlist";
import closingRouter from "./closing";
import snapshotsRouter from "./snapshots";
import feedbackRouter from "./feedback";
import clientErrorsRouter from "./clientErrors";
import ratesRouter from "./rates";
import uploadLogRouter from "./uploadLog";
import extractionLessonsRouter from "./extractionLessons";
import leaseAbstractsRouter from "./leaseAbstracts";
import siteAgreementsRouter from "./siteAgreements";
import houseViewRouter from "./houseView";
import { needs2faReverify } from "./../lib/twoFactorPolicy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);

// MANDATORY two-factor: an authenticated user who hasn't enrolled in TOTP can reach
// only the auth endpoints above (to enroll) — every data route below is blocked with
// a 2fa_setup_required code until they turn 2FA on. (Health + /auth/* are registered
// before this, so login, enrollment and status always work.)
router.use((req, res, next) => {
  if (req.session?.authenticated && !req.session.twoFactorEnabled) {
    res.status(403).json({ error: "Two-factor authentication setup is required.", code: "2fa_setup_required" });
    return;
  }
  // Periodic step-up: re-enter a code once the verification window has lapsed.
  if (req.session?.authenticated && needs2faReverify(req.session)) {
    res.status(403).json({ error: "Please re-enter your authenticator code to continue.", code: "2fa_reverify_required" });
    return;
  }
  next();
});

router.use(ingestRouter);
router.use(dealsRouter);
router.use(aliasesRouter);
router.use(tenantDecisionsRouter);
router.use(tenantIndexRouter);
router.use(analyticsRouter);
router.use(compsRouter);
router.use(watchlistRouter);
router.use(closingRouter);
router.use(snapshotsRouter);
router.use(feedbackRouter);
router.use(clientErrorsRouter);
router.use(ratesRouter);
router.use(uploadLogRouter);
router.use(extractionLessonsRouter);
router.use(leaseAbstractsRouter);
router.use(siteAgreementsRouter);
router.use(houseViewRouter);
router.use(aiRouter);

export default router;
