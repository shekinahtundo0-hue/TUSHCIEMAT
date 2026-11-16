import { Router } from "express";
import { GetMyLearnerRecordResponse, ListMyChildrenResponse } from "@workspace/api-zod";
import { inSchool, send } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { getMyLearnerRecord, listMyChildren } from "./service";

export function portalRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database, config } = deps;

  router.get("/portal/children", async (req, res) => {
    const children = await inSchool(database, req, res, ["parent"], (tx, ctx) =>
      listMyChildren(tx, ctx, config.timezone),
    );
    send(res, ListMyChildrenResponse, children);
  });

  router.get("/portal/learner", async (req, res) => {
    const learner = await inSchool(database, req, res, ["student"], (tx, ctx) =>
      getMyLearnerRecord(tx, ctx, config.timezone),
    );
    send(res, GetMyLearnerRecordResponse, learner);
  });

  return router;
}
