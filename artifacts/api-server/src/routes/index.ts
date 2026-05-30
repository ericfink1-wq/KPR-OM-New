import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import authRouter from "./auth";
import dealsRouter from "./deals";
import ingestRouter from "./ingest";
import aliasesRouter from "./aliases";
import tenantIndexRouter from "./tenantIndex";
import analyticsRouter from "./analytics";
import compsRouter from "./comps";
import snapshotsRouter from "./snapshots";
import feedbackRouter from "./feedback";
import clientErrorsRouter from "./clientErrors";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(ingestRouter);
router.use(dealsRouter);
router.use(aliasesRouter);
router.use(tenantIndexRouter);
router.use(analyticsRouter);
router.use(compsRouter);
router.use(snapshotsRouter);
router.use(feedbackRouter);
router.use(clientErrorsRouter);
router.use(aiRouter);

export default router;
