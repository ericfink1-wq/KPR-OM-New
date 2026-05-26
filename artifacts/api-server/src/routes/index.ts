import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import authRouter from "./auth";
import dealsRouter from "./deals";
import ingestRouter from "./ingest";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(ingestRouter);
router.use(dealsRouter);
router.use(aiRouter);

export default router;
