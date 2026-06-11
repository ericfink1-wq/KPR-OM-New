import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Liveness check. The deployment platform pings the API root ("/api") AND we expose
// "/api/healthz" — both return 200 from memory with NO database dependency, so a brief
// DB hiccup at boot never fails the deploy healthcheck (which would otherwise make the
// platform terminate the artifact). Readiness/DB checks live on the actual data routes.
router.get(["/", "/healthz"], (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
